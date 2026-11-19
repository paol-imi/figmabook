/*
 * Runs inside the Storybook preview page, not in Node (05). Built into a single IIFE
 * string and injected with `page.addInitScript`. It may import nothing outside this
 * folder except `@holotype/ir` types (02 §6.2), and closes over no Node values.
 */
import type { Rect } from '@holotype/ir';

/** Bumped when the page ↔ Node contract changes. */
export const SERIALIZER_PROTOCOL = 1;

/** Installed on the page as `globalThis.__holotype__`. */
export interface PageSerializer {
  readonly protocol: number;
  /** Bounding box of the capture root in page space, or `null` when it is missing. */
  measureRoot(selector: string): Rect | null;
}

const serializer: PageSerializer = {
  protocol: SERIALIZER_PROTOCOL,
  measureRoot(selector) {
    const root = document.querySelector(selector);
    if (!root) return null;
    const { x, y, width, height } = root.getBoundingClientRect();
    return { x, y, w: width, h: height };
  },
};

Object.defineProperty(globalThis, '__holotype__', { value: serializer, configurable: true });
