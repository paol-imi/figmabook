/**
 * S-02 fixture builder (main thread): shared icons and badge, and one "subject" component set
 * per mutation row. Each variant has the same 15 children of 11 node types; children carry a
 * kit role in shared plugin data so instances can find them after renames and moves.
 */
import { createLabel, dropShadow, INTER_REGULAR, NS, roleOf, setRole, solid } from '../_shared/figma.ts';
import type { MutationId } from './model.ts';

export const COLORS = {
  boxMain: '#3b82f6',
  boxOverride: '#ef4444',
  boxMutated: '#22c55e',
  boxVariable: '#a855f7',
  strokeMain: '#0f172a',
  strokeOverride: '#f59e0b',
  strokeMutated: '#64748b',
  card: '#f8fafc',
  cardB: '#fef3c7',
  shadowMain: '#000000',
  shadowOverride: '#dc2626',
  shadowMutated: '#2563eb',
  star: '#eab308',
  starMutated: '#f97316',
} as const;

export const TEXT = {
  caption: 'Caption text',
  captionOverride: 'Override text',
  captionMutated: 'Caption changed',
  label: 'Label',
  labelOverride: 'Custom label',
  labelDefaultMutated: 'New default',
} as const;

export type IconName = 'A' | 'B' | 'C';
export type Icons = Readonly<Record<IconName, ComponentNode>>;

export type SharedParts = {
  readonly icons: Icons;
  readonly badgeNeutral: ComponentNode;
  readonly collection: VariableCollection;
};

export type Subject = {
  readonly mutation: MutationId;
  readonly set: ComponentSetNode;
  readonly variantA: ComponentNode;
  readonly variable: Variable;
  /** Property ids (the part after `#`) of Label, Show icon and Icon. */
  readonly suffix: { readonly label: string; readonly bool: string; readonly swap: string };
};

export function suffixOf(propertyName: string): string {
  const hash = propertyName.lastIndexOf('#');
  return hash === -1 ? propertyName : propertyName.slice(hash + 1);
}

export async function buildIcons(figma: PluginAPI, page: PageNode): Promise<Icons> {
  const make = (name: IconName, color: string, x: number) => {
    const icon = figma.createComponent();
    icon.name = `S-02 Icon ${name}`;
    icon.resize(16, 16);
    icon.fills = [solid(color)];
    icon.cornerRadius = name === 'A' ? 0 : 8;
    icon.setSharedPluginData(NS, 'icon', name);
    page.appendChild(icon);
    icon.x = x;
    icon.y = -60;
    return icon;
  };
  return { A: make('A', '#0ea5e9', 0), B: make('B', '#ec4899', 32), C: make('C', '#84cc16', 64) };
}

export async function buildBadge(figma: PluginAPI, page: PageNode): Promise<ComponentNode> {
  const tones: Array<[string, string]> = [
    ['Neutral', '#9ca3af'],
    ['Danger', '#dc2626'],
  ];
  const variants = tones.map(([tone, color]) => {
    const badge = figma.createComponent();
    badge.name = `Tone=${tone}`;
    badge.resize(24, 12);
    badge.cornerRadius = 6;
    badge.fills = [solid(color)];
    return badge;
  });
  const set = figma.combineAsVariants(variants, page);
  set.name = 'S-02 Badge';
  set.x = 120;
  set.y = -80;
  const neutral = set.children.find((child) => child.name === 'Tone=Neutral');
  if (neutral?.type !== 'COMPONENT') throw new Error('S-02: the Badge "Tone=Neutral" variant is missing.');
  return neutral;
}

function rect(figma: PluginAPI, name: string, width: number, height: number, color: string): RectangleNode {
  const node = figma.createRectangle();
  node.name = name;
  node.resize(width, height);
  node.fills = [solid(color)];
  return node;
}

async function buildVariant(
  figma: PluginAPI,
  name: string,
  parts: SharedParts,
  variable: Variable,
): Promise<ComponentNode> {
  const component = figma.createComponent();
  component.name = name;
  component.layoutMode = 'VERTICAL';
  // resize() fixes both axes, so set the hugging height after it.
  component.resize(220, 100);
  component.counterAxisSizingMode = 'FIXED';
  component.primaryAxisSizingMode = 'AUTO';
  for (const side of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) component[side] = 12;
  component.itemSpacing = 6;
  component.fills = [solid('#ffffff')];

  const add = <T extends SceneNode>(node: T, role: string, parent: BaseNode & ChildrenMixin = component): T => {
    parent.appendChild(node);
    setRole(node, role);
    return node;
  };

  const card = add(figma.createFrame(), 'card');
  card.name = 'Card';
  card.resize(196, 24);
  card.fills = [solid(COLORS.card)];
  card.effects = [dropShadow(COLORS.shadowMain, 0, 1, 2)];

  const box = add(rect(figma, 'Box', 60, 20, COLORS.boxMain), 'box');
  box.fills = [figma.variables.setBoundVariableForPaint(solid(COLORS.boxMain), 'color', variable)];
  box.strokes = [solid(COLORS.strokeMain)];
  box.strokeWeight = 1;

  const dot = add(figma.createEllipse(), 'dot');
  dot.name = 'Dot';
  dot.resize(16, 16);
  dot.fills = [solid('#14b8a6')];

  const star = add(figma.createStar(), 'star');
  star.name = 'Star';
  star.resize(16, 16);
  star.fills = [solid(COLORS.star)];

  const polygon = add(figma.createPolygon(), 'polygon');
  polygon.name = 'Polygon';
  polygon.resize(16, 16);
  polygon.fills = [solid('#8b5cf6')];

  const line = add(figma.createLine(), 'line');
  line.name = 'Line';
  line.resize(80, 0);
  line.strokes = [solid('#94a3b8')];

  const vector = add(figma.createVector(), 'vector');
  vector.name = 'Vector';
  vector.vectorPaths = [{ windingRule: 'NONZERO', data: 'M 0 0 L 16 16 L 0 16 Z' }];
  vector.fills = [solid('#475569')];

  const label = add(await createLabel(figma, TEXT.label, 12), 'label');
  label.name = 'Label';

  const caption = add(await createLabel(figma, TEXT.caption, 12), 'caption');
  caption.name = 'Caption';

  const groupA = rect(figma, 'Group part 1', 12, 12, '#f43f5e');
  const groupB = rect(figma, 'Group part 2', 12, 12, '#fb7185');
  component.appendChild(groupA);
  component.appendChild(groupB);
  const group = figma.group([groupA, groupB], component);
  group.name = 'Group';
  setRole(group, 'group');

  const unionA = figma.createEllipse();
  const unionB = figma.createEllipse();
  unionA.resize(12, 12);
  unionB.resize(12, 12);
  component.appendChild(unionA);
  component.appendChild(unionB);
  unionB.x = 6;
  const union = figma.union([unionA, unionB], component);
  union.name = 'Union';
  setRole(union, 'union');

  const icon = add(parts.icons.A.createInstance(), 'icon');
  icon.name = 'Icon';
  const badge = add(parts.badgeNeutral.createInstance(), 'badge');
  badge.name = 'Badge';

  const inner = add(figma.createFrame(), 'inner');
  inner.name = 'Inner';
  inner.layoutMode = 'HORIZONTAL';
  inner.primaryAxisSizingMode = 'AUTO';
  inner.counterAxisSizingMode = 'AUTO';
  inner.itemSpacing = 4;
  inner.fills = [];
  add(rect(figma, 'Chip', 24, 12, '#cbd5e1'), 'chip', inner);
  return component;
}

/** One component set (State=A, State=B) with Label, Show icon and Icon properties. */
export async function buildSubject(
  figma: PluginAPI,
  mutation: MutationId,
  parts: SharedParts,
  page: PageNode,
): Promise<Subject> {
  const variable = figma.variables.createVariable(`s02/box/${mutation}`, parts.collection, 'COLOR');
  variable.setValueForMode(parts.collection.defaultModeId, { r: 59 / 255, g: 130 / 255, b: 246 / 255, a: 1 });
  const variantA = await buildVariant(figma, 'State=A', parts, variable);
  const variantB = await buildVariant(figma, 'State=B', parts, variable);
  const cardB = variantB.findOne((node) => roleOf(node) === 'card');
  if (cardB && 'fills' in cardB) cardB.fills = [solid(COLORS.cardB)];

  const set = figma.combineAsVariants([variantA, variantB], page);
  set.name = `S-02 ${mutation}`;
  set.layoutMode = 'HORIZONTAL';
  set.primaryAxisSizingMode = 'AUTO';
  set.counterAxisSizingMode = 'AUTO';
  set.itemSpacing = 16;
  for (const side of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) set[side] = 16;

  const label = set.addComponentProperty('Label', 'TEXT', TEXT.label);
  const bool = set.addComponentProperty('Show icon', 'BOOLEAN', true);
  const swap = set.addComponentProperty('Icon', 'INSTANCE_SWAP', parts.icons.A.id, {
    preferredValues: (['A', 'B', 'C'] as const).map((name) => ({
      type: 'COMPONENT' as const,
      key: parts.icons[name].key,
    })),
  });
  for (const variant of [variantA, variantB]) {
    for (const node of variant.findAll(() => true)) {
      const role = roleOf(node);
      if (role === 'label') node.componentPropertyReferences = { characters: label };
      if (role === 'icon') node.componentPropertyReferences = { visible: bool, mainComponent: swap };
    }
  }
  await figma.loadFontAsync(INTER_REGULAR);
  return {
    mutation,
    set,
    variantA,
    variable,
    suffix: { label: suffixOf(label), bool: suffixOf(bool), swap: suffixOf(swap) },
  };
}
