/*
 * The composed-tree walk (05 §3): light DOM and open shadow roots, slots flattened, skipped
 * and `display: contents` elements handled, inline content grouped into text blocks. Every
 * captured element and text block goes through the collector registry; ids and `domIndex`
 * follow walk order (pre-order).
 */
import type { CComputed, CNode, CTextStyle } from '@holotype/ir';
import { collectors } from './collectors/index';
import { createCanvasReadback } from './color';
import { elementSource, pathSegment, siblingCounter } from './source';
import { COLLAPSIBLE_WHITESPACE, preservesSpaces, whiteSpaceCollapseOf } from './text/whitespace';
import type {
  CollectContext,
  ElementDraft,
  PageCapture,
  PageDiagnostic,
  SerializeOptions,
  StyledElement,
  TextBlock,
  TextDraft,
  TextItem,
} from './types';
import { SERIALIZER_PROTOCOL } from './types';

/** Elements that never render boxes (05 §3 step 1). */
const SKIPPED_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'template',
  'head',
  'title',
  'base',
  'noscript',
  'meta',
  'link',
  'source',
  'track',
]);

/**
 * Replaced content and form controls (05 §5). This version captures their box and paint, not
 * their content: images, SVG and controls come with B-44 and B-103.
 */
const REPLACED_TAGS: ReadonlySet<string> = new Set([
  'img',
  'svg',
  'canvas',
  'video',
  'audio',
  'iframe',
  'object',
  'embed',
  'input',
  'textarea',
  'select',
  'math',
]);

/** Keys of `CComputed` a captured element must have (the schema's required ones). */
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
const REQUIRED_COMPUTED = [
  'display',
  'position',
  'boxSizing',
  'visibility',
  'zIndex',
  'opacity',
  'mixBlendMode',
  'isolation',
  'overflowX',
  'overflowY',
  'padding',
  'border',
  'margin',
  'radius',
  'background',
  'boxShadow',
  'size',
  'color',
] as const satisfies readonly RequiredKeys<CComputed>[];
// Compile-time check: the list above names every required key.
const coversRequired: Exclude<RequiredKeys<CComputed>, (typeof REQUIRED_COMPUTED)[number]> extends never
  ? true
  : never = true;
void coversRequired;

/** A thrown error that names the node: a collector-registry bug, reported as `CAP_SERIALIZE_FAILED`. */
class IncompleteNodeError extends Error {
  constructor(nodeId: string, missing: string) {
    super(`Collectors left ${missing} unset on node ${nodeId}; every captured node needs it (06 §2.1).`);
    this.name = 'IncompleteNodeError';
  }
}

interface WalkState {
  readonly context: CollectContext;
  readonly exclude: readonly string[];
  readonly styles: Map<Element, CSSStyleDeclaration>;
  next: number;
  /** Visually-hidden elements skipped (a set: `flatChildren` may visit a child twice). */
  readonly srOnly: Set<Element>;
}

function styleOf(state: WalkState, element: Element): CSSStyleDeclaration {
  let style = state.styles.get(element);
  if (style === undefined) {
    style = getComputedStyle(element);
    state.styles.set(element, style);
  }
  return style;
}

/** Children in the composed tree: assigned nodes of a slot, an open shadow root's children, or child nodes. */
function composedChildren(node: Node): readonly Node[] {
  if (node instanceof HTMLSlotElement) {
    const assigned = node.assignedNodes({ flatten: true });
    return assigned.length > 0 ? assigned : [...node.childNodes];
  }
  const root = node instanceof Element ? node.shadowRoot : null;
  return [...(root ?? node).childNodes];
}

/** Visually-hidden content (05 §3 step 1, the web2ui patterns): a 1×1 box clipped to nothing. */
function isSrOnly(element: Element, style: CSSStyleDeclaration): boolean {
  const { width, height } = element.getBoundingClientRect();
  if (width > 1 || height > 1) return false;
  const clip = style.clip.replace(/\s|,/g, '');
  return clip === 'rect(0px0px0px0px)' || /^inset\(50%\)$/.test(style.clipPath);
}

/** `true` when the element is left out with its subtree. */
function isSkipped(state: WalkState, element: Element, style: CSSStyleDeclaration): boolean {
  if (SKIPPED_TAGS.has(element.localName)) return true;
  if (style.display === 'none') return true;
  if (element.hasAttribute('data-holotype-ignore')) return true;
  if (state.exclude.some((selector) => element.matches(selector))) return true;
  if (isSrOnly(element, style)) {
    state.srOnly.add(element);
    return true;
  }
  return false;
}

/** A child as the parent's layout sees it: `display: contents` elements are replaced by their children. */
type FlatChild = Text | Element;

function flatChildren(state: WalkState, parent: Node): FlatChild[] {
  const out: FlatChild[] = [];
  for (const child of composedChildren(parent)) {
    if (child instanceof Text) {
      out.push(child);
    } else if (child instanceof Element) {
      const style = styleOf(state, child);
      if (isSkipped(state, child, style)) continue;
      if (style.display === 'contents' && !REPLACED_TAGS.has(child.localName)) out.push(...flatChildren(state, child));
      else out.push(child);
    }
  }
  return out;
}

/** An inline box that only holds text, `<br>`s and further such boxes: its text joins the block. */
function isPlainInline(state: WalkState, element: Element): boolean {
  const style = styleOf(state, element);
  if (style.display !== 'inline' || REPLACED_TAGS.has(element.localName)) return false;
  if (element.localName === 'br') return true;
  return flatChildren(state, element).every((child) => child instanceof Text || isPlainInline(state, child));
}

/** Adds an inline element's text, `<br>`s and nested inlines to the open block. */
function flattenInline(state: WalkState, element: Element, items: TextItem[], inlines: StyledElement[]): void {
  const style = styleOf(state, element);
  if (element.localName === 'br') {
    items.push({ kind: 'break', node: element, style });
    return;
  }
  inlines.push({ element, style });
  for (const child of flatChildren(state, element)) {
    if (child instanceof Text) items.push({ kind: 'text', node: child, owner: element, style });
    else flattenInline(state, child, items, inlines);
  }
}

/** Whether a block may render anything: some non-whitespace text, preserved spaces, or a `<br>`. */
function mayRender(items: readonly TextItem[]): boolean {
  return items.some(
    (item) =>
      item.kind === 'break' ||
      [...item.node.data].some((char) => !COLLAPSIBLE_WHITESPACE.test(char)) ||
      (item.node.data !== '' && preservesSpaces(whiteSpaceCollapseOf(item.style))),
  );
}

function finalizeElement(draft: ElementDraft, source: CNode['source'], children: CNode[]): CNode {
  const missing = REQUIRED_COMPUTED.find((key) => draft.computed[key] === undefined);
  if (missing !== undefined) throw new IncompleteNodeError(draft.id, `computed.${missing}`);
  if (draft.borderBox === undefined) throw new IncompleteNodeError(draft.id, 'borderBox');
  if (draft.paint === undefined) throw new IncompleteNodeError(draft.id, 'paint');
  return {
    id: draft.id,
    type: 'element',
    source,
    borderBox: draft.borderBox,
    computed: draft.computed as CComputed,
    children,
    paint: draft.paint,
  };
}

function visitText(state: WalkState, block: TextBlock, path: string, inShadow: boolean): CNode | null {
  const index = state.next;
  const draft: TextDraft = { id: `c${index + 1}` };
  for (const collector of collectors) collector.text?.({ block, index }, draft, state.context);
  if (draft.text === undefined) return null;
  state.next += 1;
  if (draft.borderBox === undefined) throw new IncompleteNodeError(draft.id, 'borderBox');
  if (draft.paint === undefined) throw new IncompleteNodeError(draft.id, 'paint');
  return {
    id: draft.id,
    type: 'text',
    source: { tag: '#text', path, ...(inShadow ? { inShadow } : {}) },
    borderBox: draft.borderBox,
    text: draft.text,
    children: [],
    paint: draft.paint,
  };
}

function visitChildren(state: WalkState, parent: Element, parentStyle: CSSStyleDeclaration, path: string): CNode[] {
  const nodes: CNode[] = [];
  // Flex and grid items are blockified: inline children are items, not part of a text run.
  const blockifies = /flex|grid/.test(parentStyle.display);
  const childPath = parent.shadowRoot === null ? path : `${path}::shadow`;
  const inShadow = parent.shadowRoot !== null || parent.getRootNode() instanceof ShadowRoot;
  const count = siblingCounter();
  let items: TextItem[] = [];
  let inlines: StyledElement[] = [];
  const flush = () => {
    if (mayRender(items)) {
      const block: TextBlock = { container: parent, containerStyle: parentStyle, items, inlines };
      const node = visitText(state, block, `${childPath}>${pathSegment('#text', count('#text'))}`, inShadow);
      if (node !== null) nodes.push(node);
    }
    items = [];
    inlines = [];
  };
  for (const child of flatChildren(state, parent)) {
    if (child instanceof Text) {
      // A text node spliced out of a `display: contents` element takes its style from there;
      // slotted text and a shadow root's own text inherit from the composed parent.
      const own = child.assignedSlot === null ? child.parentElement : null;
      const owner = own ?? parent;
      items.push({ kind: 'text', node: child, owner, style: own === null ? parentStyle : styleOf(state, own) });
    } else if (!blockifies && isPlainInline(state, child)) {
      flattenInline(state, child, items, inlines);
    } else {
      flush();
      const tag = child.localName;
      nodes.push(visitElement(state, child, parentStyle, `${childPath}>${pathSegment(tag, count(tag))}`));
    }
  }
  flush();
  return nodes;
}

function visitElement(
  state: WalkState,
  element: Element,
  parentStyle: CSSStyleDeclaration | null,
  path: string,
): CNode {
  const style = styleOf(state, element);
  const index = state.next;
  state.next += 1;
  const draft: ElementDraft = { id: `c${index + 1}`, computed: {} };
  for (const collector of collectors) collector.element?.({ element, style, parentStyle, index }, draft, state.context);
  let children: CNode[] = [];
  if (REPLACED_TAGS.has(element.localName)) {
    state.context.report({
      code: 'CAP_CSS_UNSUPPORTED',
      nodeId: draft.id,
      property: 'replaced-content',
      value: element.localName,
      fallback: 'empty box',
    });
  } else {
    children = visitChildren(state, element, style, path);
  }
  return finalizeElement(draft, elementSource(element, path), children);
}

function createContext(root: Element, diagnostics: PageDiagnostic[], textStyles: Record<string, CTextStyle>) {
  const doc = root.ownerDocument;
  const styleIds = new Map<string, string>();
  const memo = new Map<string, unknown>();
  const context: CollectContext = {
    doc,
    root,
    readback: createCanvasReadback(doc),
    report: (diagnostic) => diagnostics.push(diagnostic),
    internTextStyle(style) {
      const key = JSON.stringify(style);
      let id = styleIds.get(key);
      if (id === undefined) {
        id = `s${styleIds.size}`;
        styleIds.set(key, id);
        textStyles[id] = style;
      }
      return id;
    },
    memo<T>(key: string, compute: () => T): T {
      if (!memo.has(key)) memo.set(key, compute());
      return memo.get(key) as T;
    },
  };
  return context;
}

/** Serializes the subtree of `root` into Capture IR facts (05 §3–§4). */
export function serialize(root: Element, options: SerializeOptions = {}): PageCapture {
  const started = performance.now();
  const diagnostics: PageDiagnostic[] = [];
  const textStyles: Record<string, CTextStyle> = {};
  const state: WalkState = {
    context: createContext(root, diagnostics, textStyles),
    exclude: options.exclude ?? [],
    styles: new Map(),
    next: 0,
    srOnly: new Set(),
  };
  const parentStyle = root.parentElement === null ? null : styleOf(state, root.parentElement);
  const rootNode = visitElement(state, root, parentStyle, pathSegment(root.localName, 0));
  if (state.srOnly.size > 0) {
    const tags = [...state.srOnly].map((element) => element.localName);
    diagnostics.push({ code: 'CAP_SR_ONLY_SKIPPED', data: { count: tags.length, tags } });
  }
  return {
    protocol: SERIALIZER_PROTOCOL,
    root: rootNode,
    textStyles,
    diagnostics,
    serializeMs: performance.now() - started,
  };
}
