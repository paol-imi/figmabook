/**
 * S-02 override kinds (main thread): apply one override to an instance, and read the
 * signature of its target from an instance or from the main component.
 */
import { dropShadow, effectsSignature, findByRole, INTER_REGULAR, paintsSignature, solid } from '../_shared/figma.ts';
import { round3 } from '../_shared/json.ts';
import { COLORS, TEXT } from './fixture.ts';
import type { OverrideKey, Signature } from './model.ts';

/** Property ids (`#…` suffixes) of the subject; stable across renames (M15). */
export type Suffixes = { readonly label: string; readonly bool: string; readonly swap: string };

/** Components the overrides point at, as ids valid in the current file. */
export type OverrideTargets = { readonly iconB: string };

export const ADDED_LAYER = 'Added layer';

function propertyKey(instance: InstanceNode, suffix: string): string | undefined {
  return Object.keys(instance.componentProperties).find((name) => name.endsWith(`#${suffix}`));
}

function setProperty(instance: InstanceNode, suffix: string, value: string | boolean): void {
  const key = propertyKey(instance, suffix);
  if (!key) throw new Error(`The instance has no property #${suffix}.`);
  instance.setProperties({ [key]: value });
}

export async function applyOverride(
  figma: PluginAPI,
  key: OverrideKey,
  instance: InstanceNode,
  suffix: Suffixes,
  targets: OverrideTargets,
) {
  const target = (role: string) => {
    const node = findByRole(instance, role);
    if (!node) throw new Error(`The instance has no "${role}" layer.`);
    return node;
  };
  switch (key) {
    case 'fill':
      (target('box') as RectangleNode).fills = [solid(COLORS.boxOverride)];
      return;
    case 'stroke': {
      const box = target('box') as RectangleNode;
      box.strokes = [solid(COLORS.strokeOverride)];
      box.strokeWeight = 3;
      return;
    }
    case 'effect':
      (target('card') as FrameNode).effects = [dropShadow(COLORS.shadowOverride, 4, 4, 0)];
      return;
    case 'opacity':
      (target('dot') as EllipseNode).opacity = 0.35;
      return;
    case 'visibility':
      target('star').visible = false;
      return;
    case 'text-characters': {
      const caption = target('caption') as TextNode;
      await figma.loadFontAsync(INTER_REGULAR);
      caption.characters = TEXT.captionOverride;
      return;
    }
    case 'text-range': {
      const caption = target('caption') as TextNode;
      await figma.loadFontAsync(INTER_REGULAR);
      caption.setRangeFontSize(0, 4, 20);
      return;
    }
    case 'text-property':
      setProperty(instance, suffix.label, TEXT.labelOverride);
      return;
    case 'boolean-property':
      setProperty(instance, suffix.bool, false);
      return;
    case 'instance-swap':
      setProperty(instance, suffix.swap, targets.iconB);
      return;
    case 'nested-property': {
      const badge = target('badge');
      if (badge.type !== 'INSTANCE') throw new Error('The badge layer is not an instance.');
      badge.setProperties({ Tone: 'Danger' });
      return;
    }
    case 'resize':
      instance.resize(instance.width + 40, instance.height);
      return;
    case 'added-layer': {
      const extra = figma.createRectangle();
      extra.name = ADDED_LAYER;
      try {
        instance.appendChild(extra);
      } catch (error) {
        extra.remove();
        throw error;
      }
      return;
    }
  }
}

async function componentName(figma: PluginAPI, id: string | boolean | undefined): Promise<string> {
  if (typeof id !== 'string') return 'none';
  const node = await figma.getNodeByIdAsync(id);
  return node ? node.name : `missing:${id}`;
}

/** Property value on an instance, or the default on a main component (null when unreadable). */
function propertyValue(root: InstanceNode | ComponentNode, suffix: string): string | boolean | null {
  if (root.type === 'INSTANCE') {
    const key = propertyKey(root, suffix);
    const value = key ? root.componentProperties[key]?.value : undefined;
    return typeof value === 'string' || typeof value === 'boolean' ? value : null;
  }
  const owner = root.parent?.type === 'COMPONENT_SET' ? root.parent : null;
  if (!owner) return null;
  const entry = Object.entries(owner.componentPropertyDefinitions).find(([name]) => name.endsWith(`#${suffix}`));
  const value = entry?.[1].defaultValue;
  return typeof value === 'string' || typeof value === 'boolean' ? value : null;
}

/** Reads the signature of an override kind's target; null when the target layer is gone. */
export async function readSignature(
  figma: PluginAPI,
  key: OverrideKey,
  root: InstanceNode | ComponentNode,
  suffix: Suffixes,
): Promise<Signature | null> {
  const find = (role: string) => findByRole(root, role) ?? null;
  switch (key) {
    case 'fill': {
      const box = find('box');
      return box && 'fills' in box ? paintsSignature(box.fills) : null;
    }
    case 'stroke': {
      const box = find('box');
      return box && 'strokes' in box ? { paint: paintsSignature(box.strokes), weight: String(box.strokeWeight) } : null;
    }
    case 'effect': {
      const card = find('card');
      return card && 'effects' in card ? effectsSignature(card.effects) : null;
    }
    case 'opacity': {
      const dot = find('dot');
      return dot && 'opacity' in dot ? String(round3(dot.opacity)) : null;
    }
    case 'visibility': {
      const star = find('star');
      return star ? String(star.visible) : null;
    }
    case 'text-characters': {
      const caption = find('caption');
      return caption?.type === 'TEXT' ? caption.characters : null;
    }
    case 'text-range': {
      const caption = find('caption');
      if (caption?.type !== 'TEXT') return null;
      const first = caption.getStyledTextSegments(['fontSize'])[0];
      return first ? `first=${round3(first.fontSize)}` : 'empty';
    }
    case 'text-property': {
      const label = find('label');
      return {
        prop: String(propertyValue(root, suffix.label)),
        text: label?.type === 'TEXT' ? label.characters : 'none',
      };
    }
    case 'boolean-property': {
      const icon = find('icon');
      return { prop: String(propertyValue(root, suffix.bool)), visible: icon ? String(icon.visible) : 'none' };
    }
    case 'instance-swap': {
      const icon = find('icon');
      const main = icon?.type === 'INSTANCE' ? await icon.getMainComponentAsync() : null;
      return {
        prop: await componentName(figma, propertyValue(root, suffix.swap) ?? undefined),
        layer: main?.name ?? 'none',
      };
    }
    case 'nested-property': {
      const badge = find('badge');
      return badge?.type === 'INSTANCE' ? JSON.stringify(badge.variantProperties ?? {}) : null;
    }
    case 'resize':
      return String(round3(root.width));
    case 'added-layer':
      return String(root.findAll((node) => node.name === ADDED_LAYER).length);
  }
}
