/*
 * Runs inside the Storybook preview page, not in Node (05 §2). Built into a single IIFE
 * string and injected with `addInitScript`, before any Storybook or component code. It may
 * import nothing outside this folder except `@holotype/ir` types (02 §6.2), and closes over
 * no Node values.
 */
import { type PageCapture, SERIALIZER_PROTOCOL, type SerializeOptions } from './types';
import { serialize } from './walk';

export { SERIALIZER_PROTOCOL } from './types';

/** The global the serializer installs (05 §2.1). */
export const PAGE_GLOBAL = '__holotype';

/** Installed on the page as `globalThis.__holotype`. */
export interface PageSerializer {
  readonly protocol: number;
  /** Serializes the subtree of `root` (the capture root) into Capture IR facts. */
  serialize(root: Element, options?: SerializeOptions): PageCapture;
}

const api: PageSerializer = { protocol: SERIALIZER_PROTOCOL, serialize };

Object.defineProperty(globalThis, PAGE_GLOBAL, { value: Object.freeze(api), configurable: true });
