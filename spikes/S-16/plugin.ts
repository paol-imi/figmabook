/**
 * S-16 main thread: builds the Button-like set, makes one instance per case, reverse-maps
 * each to args, rebuilds a fresh instance from those args and compares the two.
 */
import { createLabel, dropShadow, layoutGrid, NS, probe, roleOf, setRole, solid, usePage } from '../_shared/figma.ts';
import { errorMessage } from '../_shared/json.ts';
import type { MainContext } from '../_shared/spike.ts';
import {
  BADGE_DEFS,
  BUTTON_DEFS,
  CASES,
  type CaseEdit,
  ICON_SIDS,
  type RoundTripCase,
  SIZE_VALUES,
  VARIANT_VALUES,
} from './cases.ts';
import {
  compareSnapshots,
  forwardMap,
  type InstanceSnapshot,
  type NestedSnapshot,
  type PropDef,
  type RoundTripDiff,
  reverseMap,
} from './model.ts';

export const PAGE_NAME = 'S-16 Round trip';
const FILLS: Readonly<Record<string, string>> = { Primary: '#4f46e5', Secondary: '#e5e7eb', Danger: '#dc2626' };

type Fixture = {
  readonly set: ComponentSetNode;
  readonly icons: ReadonlyMap<string, ComponentNode>;
};

function displayName(propertyName: string): string {
  const hash = propertyName.lastIndexOf('#');
  return hash === -1 ? propertyName : propertyName.slice(0, hash);
}

async function buildIcon(figma: PluginAPI, sid: string, color: string): Promise<ComponentNode> {
  const icon = figma.createComponent();
  icon.name = `Icon/${sid.replace('icon-', '')}`;
  icon.resize(16, 16);
  const dot = figma.createEllipse();
  dot.resize(12, 12);
  dot.x = 2;
  dot.y = 2;
  dot.fills = [solid(color)];
  icon.appendChild(dot);
  icon.setSharedPluginData(NS, 'sid', sid);
  return icon;
}

async function buildBadgeSet(figma: PluginAPI, page: PageNode): Promise<ComponentSetNode> {
  const tones: Array<[string, string]> = [
    ['Neutral', '#9ca3af'],
    ['Info', '#0ea5e9'],
  ];
  const variants: ComponentNode[] = [];
  for (const [tone, color] of tones) {
    const badge = figma.createComponent();
    badge.name = `Tone=${tone}`;
    badge.resize(12, 12);
    badge.cornerRadius = 6;
    badge.fills = [solid(color)];
    variants.push(badge);
  }
  const set = figma.combineAsVariants(variants, page);
  set.name = 'S-16 Badge';
  set.setSharedPluginData(NS, 'props', JSON.stringify(BADGE_DEFS));
  return set;
}

async function buildButtonVariant(
  figma: PluginAPI,
  variant: string,
  size: string,
  star: ComponentNode,
  badge: ComponentNode,
): Promise<ComponentNode> {
  const component = figma.createComponent();
  component.name = `Variant=${variant}, Size=${size}`;
  component.layoutMode = 'HORIZONTAL';
  component.primaryAxisSizingMode = 'AUTO';
  component.counterAxisSizingMode = 'AUTO';
  component.counterAxisAlignItems = 'CENTER';
  const pad = size === 'sm' ? 6 : 10;
  component.paddingTop = pad;
  component.paddingBottom = pad;
  component.paddingLeft = pad * 1.5;
  component.paddingRight = pad * 1.5;
  component.itemSpacing = 6;
  component.cornerRadius = 6;
  component.fills = [solid(FILLS[variant] ?? '#4f46e5')];

  const icon = star.createInstance();
  icon.name = 'Icon';
  setRole(icon, 'icon');
  const label = await createLabel(figma, 'Button', size === 'sm' ? 12 : 14);
  label.name = 'Label';
  setRole(label, 'label');
  const hint = await createLabel(figma, 'hint', 10);
  hint.name = 'Hint';
  setRole(hint, 'hint');
  const badgeInstance = badge.createInstance();
  badgeInstance.name = 'Badge';
  setRole(badgeInstance, 'badge');
  for (const child of [icon, label, hint, badgeInstance]) component.appendChild(child);
  return component;
}

async function buildFixture(figma: PluginAPI, page: PageNode): Promise<Fixture> {
  const colors = ['#f59e0b', '#ef4444', '#eab308'];
  const icons = new Map<string, ComponentNode>();
  for (const [index, sid] of ICON_SIDS.entries()) {
    const icon = await buildIcon(figma, sid, colors[index] ?? '#000000');
    page.appendChild(icon);
    icon.x = index * 32;
    icon.y = -80;
    icons.set(sid, icon);
  }
  const star = icons.get('icon-star');
  const heart = icons.get('icon-heart');
  if (!star || !heart) throw new Error('S-16: icon components were not created.');

  const badgeSet = await buildBadgeSet(figma, page);
  badgeSet.y = -80;
  badgeSet.x = 120;
  const neutral = badgeSet.children.find((child) => child.name === 'Tone=Neutral');
  if (neutral?.type !== 'COMPONENT') throw new Error('S-16: the Badge "Tone=Neutral" variant is missing.');

  const variants: ComponentNode[] = [];
  for (const variant of VARIANT_VALUES) {
    for (const size of SIZE_VALUES) variants.push(await buildButtonVariant(figma, variant, size, star, neutral));
  }
  const set = figma.combineAsVariants(variants, page);
  set.name = 'S-16 Button';
  layoutGrid(set.children, { x: 16, y: 16, columns: SIZE_VALUES.length, gap: 16 });
  set.resizeWithoutConstraints(
    Math.max(...set.children.map((child) => child.x + child.width)) + 16,
    Math.max(...set.children.map((child) => child.y + child.height)) + 16,
  );

  const labelKey = set.addComponentProperty('Label', 'TEXT', 'Button');
  const showKey = set.addComponentProperty('Show icon', 'BOOLEAN', true);
  const iconKey = set.addComponentProperty('Icon', 'INSTANCE_SWAP', star.id, {
    preferredValues: [
      { type: 'COMPONENT', key: star.key },
      { type: 'COMPONENT', key: heart.key },
    ],
  });
  for (const variant of set.children) {
    if (variant.type !== 'COMPONENT') continue;
    for (const child of variant.children) {
      const role = roleOf(child);
      if (role === 'label') child.componentPropertyReferences = { characters: labelKey };
      if (role === 'icon') child.componentPropertyReferences = { visible: showKey, mainComponent: iconKey };
    }
  }
  set.setSharedPluginData(NS, 'props', JSON.stringify(BUTTON_DEFS));
  set.setSharedPluginData(
    NS,
    'propNames',
    JSON.stringify({ 'arg:children': labelKey, 'arg:iconPosition': showKey, 'arg:icon': iconKey }),
  );
  return { set, icons };
}

function propertyName(instance: InstanceNode, display: string): string | undefined {
  return Object.keys(instance.componentProperties).find((name) => displayName(name) === display);
}

function sublayer(instance: InstanceNode, role: string): SceneNode | undefined {
  return instance.findOne((node) => roleOf(node) === role) ?? undefined;
}

async function applyEdit(figma: PluginAPI, instance: InstanceNode, edit: CaseEdit, fixture: Fixture): Promise<void> {
  const icon = (sid: string) => {
    const found = fixture.icons.get(sid);
    if (!found) throw new Error(`Unknown icon ${sid}`);
    return found;
  };
  switch (edit.kind) {
    case 'variant':
      instance.setProperties({ ...edit.values });
      return;
    case 'props': {
      const values: Record<string, string | boolean> = {};
      for (const [display, value] of Object.entries(edit.values)) {
        const name = propertyName(instance, display);
        if (!name) throw new Error(`The instance has no "${display}" property.`);
        values[name] = value;
      }
      instance.setProperties(values);
      return;
    }
    case 'swap': {
      const name = propertyName(instance, 'Icon');
      if (!name) throw new Error('The instance has no "Icon" property.');
      instance.setProperties({ [name]: icon(edit.sid).id });
      return;
    }
    case 'swap-sublayer': {
      const node = sublayer(instance, 'icon');
      if (node?.type !== 'INSTANCE') throw new Error('The icon layer is missing.');
      node.swapComponent(icon(edit.sid));
      return;
    }
    case 'sublayer-characters': {
      const node = sublayer(instance, edit.role);
      if (node?.type !== 'TEXT') throw new Error(`The ${edit.role} layer is not text.`);
      await figma.loadFontAsync(node.fontName as FontName);
      node.characters = edit.text;
      return;
    }
    case 'sublayer-visible': {
      const node = sublayer(instance, edit.role);
      if (!node) throw new Error(`The ${edit.role} layer is missing.`);
      node.visible = edit.visible;
      return;
    }
    case 'fill':
      instance.fills = [solid('#10b981')];
      return;
    case 'effect':
      instance.effects = [dropShadow('#111827', 0, 2, 6)];
      return;
    case 'resize':
      instance.resize(edit.width, instance.height);
      return;
    case 'nested-variant': {
      const node = sublayer(instance, edit.role);
      if (node?.type !== 'INSTANCE') throw new Error(`The ${edit.role} layer is not an instance.`);
      node.setProperties({ ...edit.values });
      return;
    }
  }
}

async function propDefsOf(instance: InstanceNode): Promise<readonly PropDef[] | null> {
  const main = await instance.getMainComponentAsync();
  const owner = main?.parent?.type === 'COMPONENT_SET' ? main.parent : main;
  const raw = owner?.getSharedPluginData(NS, 'props') ?? '';
  return raw ? (JSON.parse(raw) as PropDef[]) : null;
}

async function snapshot(figma: PluginAPI, instance: InstanceNode): Promise<InstanceSnapshot> {
  const props: Record<string, string | boolean> = {};
  const swaps: Record<string, string> = {};
  for (const [name, property] of Object.entries(instance.componentProperties)) {
    if (property.type === 'VARIANT') continue;
    const display = displayName(name);
    if (property.type === 'INSTANCE_SWAP') {
      const target = await figma.getNodeByIdAsync(String(property.value));
      swaps[display] = target ? target.getSharedPluginData(NS, 'sid') || target.name : String(property.value);
    } else if (typeof property.value === 'string' || typeof property.value === 'boolean') {
      props[display] = property.value;
    }
  }
  const roleById = (id: string) => {
    if (id === instance.id) return 'root';
    const node = instance.findOne((candidate) => candidate.id === id);
    return node ? roleOf(node) || node.name : id;
  };
  const referencedFields: Record<string, string[]> = {};
  const nested: Record<string, NestedSnapshot> = {};
  for (const node of instance.findAll((candidate) => roleOf(candidate) !== '')) {
    const role = roleOf(node);
    referencedFields[role] = Object.keys(node.componentPropertyReferences ?? {}).sort();
    if (node.type === 'INSTANCE') {
      const defs = await propDefsOf(node);
      if (defs) nested[role] = { defs, snapshot: await snapshot(figma, node) };
    }
  }
  return {
    variant: { ...(instance.variantProperties ?? {}) },
    props,
    swaps,
    overrides: instance.overrides.map((entry) => ({
      role: roleById(entry.id),
      fields: [...entry.overriddenFields].sort(),
    })),
    referencedFields,
    nested,
  };
}

/** Builds a fresh instance of the default variant from the args (forward map). */
async function rebuild(
  defaultVariant: ComponentNode,
  args: ReturnType<typeof reverseMap>,
  fixture: Fixture,
): Promise<InstanceNode> {
  const fresh = defaultVariant.createInstance();
  const forward = forwardMap(BUTTON_DEFS, args.args);
  const values: Record<string, string | boolean> = { ...forward.variant };
  for (const [display, value] of Object.entries(forward.props)) {
    const name = propertyName(fresh, display);
    if (name) values[name] = value;
  }
  for (const [display, sid] of Object.entries(forward.swaps)) {
    const name = propertyName(fresh, display);
    const target = fixture.icons.get(sid);
    if (name && target) values[name] = target.id;
  }
  fresh.setProperties(values);
  for (const [role, nested] of Object.entries(args.nested)) {
    const node = sublayer(fresh, role);
    if (node?.type === 'INSTANCE') node.setProperties({ ...forwardMap(BADGE_DEFS, nested.args).variant });
  }
  return fresh;
}

export type CaseRow = {
  id: string;
  label: string;
  kinds: RoundTripCase['kinds'];
  applied: boolean;
  applyError: string | null;
  args: ReturnType<typeof reverseMap>['args'];
  nestedArgs: Record<string, ReturnType<typeof reverseMap>['args']>;
  unmapped: ReturnType<typeof reverseMap>['unmapped'];
  deviations: ReturnType<typeof reverseMap>['deviations'];
  roundTrip: boolean;
  diffs: RoundTripDiff[];
  surprise: string[];
  error: string | null;
};

async function runCase(
  figma: PluginAPI,
  testCase: RoundTripCase,
  fixture: Fixture,
  defaultVariant: ComponentNode,
  row: number,
  page: PageNode,
): Promise<CaseRow> {
  const base: Omit<CaseRow, 'roundTrip' | 'diffs' | 'surprise' | 'error' | 'applied' | 'applyError'> = {
    id: testCase.id,
    label: testCase.label,
    kinds: testCase.kinds,
    args: {},
    nestedArgs: {},
    unmapped: [],
    deviations: [],
  };
  const instance = defaultVariant.createInstance();
  instance.name = `${testCase.id} ${testCase.label}`;
  page.appendChild(instance);
  instance.x = 0;
  instance.y = 360 + row * 56;

  let applyError: string | null = null;
  for (const edit of testCase.edits) {
    const result = await probe(() => applyEdit(figma, instance, edit, fixture));
    if (!result.ok) applyError = `${edit.kind}: ${result.error}`;
  }
  try {
    const before = await snapshot(figma, instance);
    const mapped = reverseMap(BUTTON_DEFS, before);
    const fresh = await rebuild(defaultVariant, mapped, fixture);
    page.appendChild(fresh);
    fresh.name = `${testCase.id} rebuilt`;
    fresh.x = 320;
    fresh.y = instance.y;
    const after = await snapshot(figma, fresh);
    const diffs = compareSnapshots(before, after);
    const nestedArgs: CaseRow['nestedArgs'] = {};
    for (const [role, nested] of Object.entries(mapped.nested)) nestedArgs[role] = nested.args;
    const surprise: string[] = [];
    if (mapped.unmapped.length > 0 !== testCase.expect.unmapped)
      surprise.push(`unmapped: expected ${testCase.expect.unmapped}`);
    if (mapped.deviations.length > 0 !== testCase.expect.deviation)
      surprise.push(`deviation: expected ${testCase.expect.deviation}`);
    return {
      ...base,
      applied: applyError === null,
      applyError,
      args: mapped.args,
      nestedArgs,
      unmapped: mapped.unmapped,
      deviations: mapped.deviations,
      roundTrip: diffs.length === 0,
      diffs,
      surprise,
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      applied: applyError === null,
      applyError,
      roundTrip: false,
      diffs: [],
      surprise: [],
      error: errorMessage(error),
    };
  }
}

async function run({ figma, progress }: MainContext, _input: null) {
  progress('Building the test components…');
  const page = await usePage(figma, PAGE_NAME);
  const fixture = await buildFixture(figma, page);
  const defaultVariant = fixture.set.defaultVariant;
  const rows: CaseRow[] = [];
  for (const [index, testCase] of CASES.entries()) {
    progress(`Case ${index + 1} of ${CASES.length}: ${testCase.label}`);
    rows.push(await runCase(figma, testCase, fixture, defaultVariant, index, page));
  }
  figma.viewport.scrollAndZoomIntoView([fixture.set]);
  return { rows };
}

export const s16Tasks = { 'S-16/run': run };
