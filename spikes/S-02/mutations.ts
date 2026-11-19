/**
 * S-02 mutations (main thread): the 19 in-place edits of 10 §11.1, each applied to its own
 * subject set so rows do not interfere.
 */
import { createLabel, dropShadow, findByRole, INTER_REGULAR, roleOf, setRole, solid } from '../_shared/figma.ts';
import { errorMessage } from '../_shared/json.ts';
import { COLORS, type Icons, TEXT } from './fixture.ts';
import type { MutationId, MutationStatus } from './model.ts';

export type LiveSubject = {
  readonly set: ComponentSetNode;
  readonly variantA: ComponentNode;
  readonly variable: Variable;
  readonly icons: Icons;
  readonly page: PageNode;
};

/** Layers that carry an override in some column (10 §11.1). */
const TARGETS = ['box', 'card', 'dot', 'star', 'caption', 'label', 'icon', 'badge'] as const;
const PLAIN_TARGETS = ['box', 'card', 'dot', 'star', 'caption'] as const;

type Container = BaseNode & ChildrenMixin;

function targetsOf(variant: ComponentNode, roles: readonly string[]): SceneNode[] {
  return roles.map((role) => findByRole(variant, role)).filter((node): node is SceneNode => node !== undefined);
}

function parentOf(node: SceneNode): Container {
  const parent = node.parent;
  if (!parent || !('children' in parent)) throw new Error(`${node.name} has no parent.`);
  return parent as Container;
}

function replaceNode(old: SceneNode, next: SceneNode): void {
  const parent = parentOf(old);
  parent.insertChild(parent.children.indexOf(old), next);
  old.remove();
}

/** Copies what an override could touch from one layer to its replacement. */
function copyCommon(from: SceneNode, to: SceneNode): void {
  to.name = from.name;
  setRole(to, roleOf(from));
  if ('fills' in from && 'fills' in to && Array.isArray(from.fills)) to.fills = from.fills;
  if ('strokes' in from && 'strokes' in to) {
    to.strokes = from.strokes;
    if (typeof from.strokeWeight === 'number') to.strokeWeight = from.strokeWeight;
  }
  if ('effects' in from && 'effects' in to) to.effects = from.effects;
  if ('opacity' in from && 'opacity' in to) to.opacity = from.opacity;
  to.visible = from.visible;
  if ('resize' in to && to.type !== 'TEXT') to.resize(Math.max(from.width, 0.01), Math.max(from.height, 0.01));
  if (from.componentPropertyReferences) to.componentPropertyReferences = { ...from.componentPropertyReferences };
}

async function recreate(figma: PluginAPI, node: SceneNode): Promise<SceneNode> {
  switch (node.type) {
    case 'RECTANGLE':
      return figma.createRectangle();
    case 'ELLIPSE':
      return figma.createEllipse();
    case 'STAR':
      return figma.createStar();
    case 'FRAME':
      return figma.createFrame();
    case 'TEXT': {
      const text = await createLabel(figma, node.characters, typeof node.fontSize === 'number' ? node.fontSize : 12);
      return text;
    }
    default:
      throw new Error(`recreate: ${node.type} is not handled`);
  }
}

/** M07 target types: rect→frame, frame→text, ellipse→rect, star→polygon. */
async function convert(figma: PluginAPI, node: SceneNode): Promise<SceneNode | null> {
  switch (node.type) {
    case 'RECTANGLE':
      return figma.createFrame();
    case 'FRAME':
      return createLabel(figma, node.name, 12);
    case 'ELLIPSE':
      return figma.createRectangle();
    case 'STAR':
      return figma.createPolygon();
    default:
      return null;
  }
}

function propertyName(set: ComponentSetNode, display: string): string | undefined {
  return Object.keys(set.componentPropertyDefinitions).find((name) => name.split('#')[0] === display);
}

async function mutate(figma: PluginAPI, id: MutationId, subject: LiveSubject, notes: string[]): Promise<void> {
  const { set, variantA, icons } = subject;
  await figma.loadFontAsync(INTER_REGULAR);
  switch (id) {
    case 'M01': {
      for (const node of targetsOf(variantA, PLAIN_TARGETS)) {
        const role = roleOf(node);
        if (role === 'box' && node.type === 'RECTANGLE') {
          node.fills = [solid(COLORS.boxMutated)];
          node.strokes = [solid(COLORS.strokeMutated)];
          node.strokeWeight = 2;
          node.resize(70, 24);
        }
        if (role === 'card' && node.type === 'FRAME') node.effects = [dropShadow(COLORS.shadowMutated, 0, 2, 8)];
        if (role === 'dot' && node.type === 'ELLIPSE') node.opacity = 0.8;
        if (role === 'star' && node.type === 'STAR') node.fills = [solid(COLORS.starMutated)];
        if (role === 'caption' && node.type === 'TEXT') {
          node.characters = TEXT.captionMutated;
          node.fontSize = 13;
        }
      }
      notes.push('changed: box fill/stroke/size, card effect, dot opacity, star fill, caption text and size');
      return;
    }
    case 'M02':
      for (const node of targetsOf(variantA, TARGETS)) node.name = `${node.name} renamed`;
      return;
    case 'M03': {
      const children = [...variantA.children];
      for (const [index, child] of children.reverse().entries()) variantA.insertChild(index, child);
      return;
    }
    case 'M04': {
      const inner = findByRole(variantA, 'inner');
      if (inner?.type !== 'FRAME') throw new Error('Inner frame missing');
      for (const node of targetsOf(variantA, TARGETS)) inner.appendChild(node);
      return;
    }
    case 'M05':
      for (const node of targetsOf(variantA, TARGETS)) {
        const wrap = figma.createFrame();
        wrap.name = `Wrap ${node.name}`;
        wrap.layoutMode = 'HORIZONTAL';
        wrap.primaryAxisSizingMode = 'AUTO';
        wrap.counterAxisSizingMode = 'AUTO';
        wrap.fills = [];
        replaceNode(node, wrap);
        wrap.appendChild(node);
      }
      return;
    case 'M06':
      for (const node of targetsOf(variantA, [...PLAIN_TARGETS, 'label'])) {
        const next = await recreate(figma, node);
        copyCommon(node, next);
        replaceNode(node, next);
      }
      return;
    case 'M07':
      for (const node of targetsOf(variantA, PLAIN_TARGETS)) {
        const next = await convert(figma, node);
        if (!next) {
          notes.push(`${roleOf(node)}: no type change for ${node.type}`);
          continue;
        }
        copyCommon(node, next);
        replaceNode(node, next);
        notes.push(`${roleOf(next)}: ${node.type}→${next.type}`);
      }
      return;
    case 'M08':
      variantA.layoutMode = 'HORIZONTAL';
      return;
    case 'M09': {
      const sibling = figma.createRectangle();
      sibling.name = 'New sibling';
      sibling.resize(20, 8);
      variantA.insertChild(0, sibling);
      return;
    }
    case 'M10':
      for (const node of targetsOf(variantA, ['line', 'polygon'])) node.remove();
      return;
    case 'M11':
      variantA.name = 'State=Alpha';
      return;
    case 'M12':
      set.editComponentProperty('State', { name: 'Mode' });
      return;
    case 'M13':
      try {
        set.addComponentProperty('Size', 'VARIANT', 'md');
        notes.push('added with addComponentProperty(VARIANT)');
      } catch (error) {
        notes.push(`addComponentProperty(VARIANT) failed (${errorMessage(error)}); renamed variants instead`);
        for (const child of set.children) child.name = `${child.name}, Size=md`;
      }
      return;
    case 'M14': {
      const next = variantA.clone();
      next.name = 'State=C';
      set.appendChild(next);
      return;
    }
    case 'M15': {
      const renames: Array<[string, string]> = [
        ['Label', 'Title'],
        ['Show icon', 'Icon visible'],
        ['Icon', 'Glyph'],
      ];
      for (const [from, to] of renames) {
        const name = propertyName(set, from);
        if (!name) throw new Error(`Property ${from} missing`);
        notes.push(`${name} → ${set.editComponentProperty(name, { name: to })}`);
      }
      return;
    }
    case 'M16': {
      const label = propertyName(set, 'Label');
      const bool = propertyName(set, 'Show icon');
      const swap = propertyName(set, 'Icon');
      if (!label || !bool || !swap) throw new Error('A property is missing');
      set.editComponentProperty(label, { defaultValue: TEXT.labelDefaultMutated });
      set.editComponentProperty(bool, { defaultValue: false });
      set.editComponentProperty(swap, { defaultValue: icons.C.id });
      notes.push('defaults: Label → "New default", Show icon → false, Icon → C');
      return;
    }
    case 'M17': {
      const section = figma.createSection();
      section.name = 'S-02 Moved set';
      subject.page.appendChild(section);
      section.x = set.x;
      section.y = set.y;
      section.resizeWithoutConstraints(set.width + 40, set.height + 40);
      section.appendChild(set);
      set.x = 20;
      set.y = 20;
      return;
    }
    case 'M18':
      subject.variable.setValueForMode(Object.keys(subject.variable.valuesByMode)[0] ?? '', {
        r: 168 / 255,
        g: 85 / 255,
        b: 247 / 255,
        a: 1,
      });
      return;
    case 'M19': {
      const icon = findByRole(variantA, 'icon');
      if (icon?.type !== 'INSTANCE') throw new Error('Icon instance missing');
      icon.swapComponent(icons.C);
      return;
    }
  }
}

export async function applyMutation(figma: PluginAPI, id: MutationId, subject: LiveSubject): Promise<MutationStatus> {
  const notes: string[] = [];
  try {
    await mutate(figma, id, subject, notes);
    return { applied: true, notes, error: null };
  } catch (error) {
    return { applied: false, notes, error: errorMessage(error) };
  }
}
