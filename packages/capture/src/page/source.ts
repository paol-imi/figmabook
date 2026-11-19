import type { CSource } from '@holotype/ir';

/** The IR keeps at most this many classes per node (06 §2.1). */
const MAX_CLASSES = 16;

const firstAttribute = (element: Element, names: readonly string[]): string | undefined => {
  for (const name of names) {
    const value = element.getAttribute(name);
    if (value !== null && value !== '') return value;
  }
  return undefined;
};

/**
 * Identity facts of an element (06 §2.1 `CSource`): tag, structural path, classes and the
 * explicit naming hints. Only present facts are set.
 */
export function elementSource(element: Element, path: string): CSource {
  const source: CSource = { tag: element.localName, path };
  const classes = [...element.classList].slice(0, MAX_CLASSES);
  if (classes.length > 0) source.classes = classes;
  if (element.id !== '') source.id = element.id;
  const testId = firstAttribute(element, ['data-testid', 'data-test', 'data-cy']);
  if (testId !== undefined) source.testId = testId;
  const figmaName = firstAttribute(element, ['data-holotype-name', 'data-figma-name']);
  if (figmaName !== undefined) source.figmaName = figmaName;
  const figmaKey = firstAttribute(element, ['data-holotype-key', 'data-figma-key']);
  if (figmaKey !== undefined) source.figmaKey = figmaKey;
  const role = firstAttribute(element, ['role']);
  if (role !== undefined) source.role = role;
  const ariaLabel = firstAttribute(element, ['aria-label']);
  if (ariaLabel !== undefined) source.ariaLabel = ariaLabel;
  if (element.getRootNode() instanceof ShadowRoot) source.inShadow = true;
  if (element.shadowRoot !== null) source.shadowHost = true;
  const slot = element.getAttribute('slot');
  if (slot !== null && slot !== '') source.slotName = slot;
  return source;
}

/** One path segment: the tag and its index among composed siblings with the same tag (05 §3 step 8). */
export function pathSegment(tag: string, index: number): string {
  return `${tag}:${index}`;
}

/** Counts siblings per tag while a parent's children are emitted, for {@link pathSegment}. */
export function siblingCounter(): (tag: string) => number {
  const seen = new Map<string, number>();
  return (tag) => {
    const index = seen.get(tag) ?? 0;
    seen.set(tag, index + 1);
    return index;
  };
}
