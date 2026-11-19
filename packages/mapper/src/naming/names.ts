import type { CNode, SceneNodeKind } from '@holotype/ir';
import { type SyntheticRole, sourceElement, type WorkNode } from '../state';
import { semanticClass } from './classes';

/*
 * Layer names (07 §12): the first source in `naming.layers` order that gives one, then a
 * text node's characters, then the node kind. Sibling names are made unique with ` 2`,
 * ` 3` in child order, because Figma matches overrides by name and hierarchy.
 */

export interface NameContext {
  /** `naming.layers` (16 §10), e.g. `['data-holotype-name', 'data-testid', …]`. */
  readonly layers: readonly string[];
  /** Capture node id → display name, for nodes that are a framework component's root. */
  readonly boundaries: ReadonlyMap<string, string>;
  readonly keepClass: (className: string) => boolean;
}

const SEMANTIC_TAGS: Readonly<Record<string, string>> = {
  nav: 'Navigation',
  ul: 'List',
  ol: 'List',
  li: 'Item',
  img: 'Image',
  svg: 'Icon',
  input: 'Input',
  label: 'Label',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  p: 'Paragraph',
  a: 'Link',
};

const KIND_NAMES: Readonly<Record<SceneNodeKind, string>> = {
  component: 'Component',
  frame: 'Frame',
  group: 'Group',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  text: 'Text',
  vector: 'Vector',
  svg: 'Icon',
  image: 'Image',
  instance: 'Instance',
};

/** Names of the layers the mapper adds (07 §12 rule 9). */
const SYNTHETIC_NAMES: Readonly<Record<SyntheticRole, string>> = {
  bg: 'Background',
  'border-t': 'Border top',
  'border-r': 'Border right',
  'border-b': 'Border bottom',
  'border-l': 'Border left',
  outline: 'Outline',
  shadow: 'Shadow',
  clip: 'Clip',
};

const MAX_TEXT_NAME = 40;

/** `btn-label` → `Btn label`, `primaryAction` → `Primary action`. */
export function humanize(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** BEM `block__elem--mod` → `Elem`; otherwise the block without its modifier. */
function classLabel(className: string): string {
  const [block = '', element] = className.split('__');
  const base = (element ?? block).split('--')[0] ?? '';
  return humanize(base);
}

/** A text node's characters, whitespace-collapsed and cut to 40 characters. */
function textLabel(characters: string): string {
  const collapsed = characters.replace(/\s+/g, ' ').trim();
  return Array.from(collapsed).slice(0, MAX_TEXT_NAME).join('').trimEnd();
}

function fromLayer(layer: string, node: CNode, context: NameContext): string | undefined {
  const { source } = node;
  switch (layer) {
    case 'data-holotype-name':
    case 'data-figma-name':
      return source.figmaName;
    case 'data-testid':
      return source.testId === undefined ? undefined : humanize(source.testId);
    case 'component':
      return context.boundaries.get(node.id);
    case 'aria':
      return source.ariaLabel ?? (source.role === undefined ? undefined : humanize(source.role));
    case 'semantic':
      return SEMANTIC_TAGS[source.tag];
    case 'class': {
      const className = semanticClass(source.classes, context.keepClass);
      return className === undefined ? undefined : classLabel(className);
    }
    default:
      return undefined;
  }
}

/** The name of one node, before sibling disambiguation. */
export function layerName(node: WorkNode, context: NameContext): string {
  if (node.synthetic !== undefined) return SYNTHETIC_NAMES[node.synthetic];
  // A text layer that replaced its element is named like the element (07 §11 rule 3).
  const element = sourceElement(node);
  for (const layer of context.layers) {
    const name = fromLayer(layer, element, context)?.trim();
    if (name) return name;
  }
  const text = node.capture.text === undefined ? '' : textLabel(node.capture.text.characters);
  if (text !== '') return text;
  if (element.source.pseudo) return humanize(element.source.pseudo);
  return KIND_NAMES[node.kind];
}

/** Sets `name` on every node below `root`, unique among siblings; the root gets `rootName`. */
export function assignNames(root: WorkNode, rootName: string, context: NameContext): void {
  root.name = rootName;
  const visit = (node: WorkNode): void => {
    const taken = new Set<string>();
    const counts = new Map<string, number>();
    for (const child of node.children) {
      const base = layerName(child, context);
      let count = counts.get(base) ?? 0;
      let name: string;
      do {
        count += 1;
        name = count === 1 ? base : `${base} ${count}`;
      } while (taken.has(name));
      counts.set(base, count);
      taken.add(name);
      child.name = name;
      visit(child);
    }
  };
  visit(root);
}
