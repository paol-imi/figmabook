import { isAbsolute, posix, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/** Attribute stamped on host JSX elements; capture reads it into `CSource.loc` (15 §5.2). */
export const LOC_ATTRIBUTE = 'data-holotype-loc';

/** `src/components/Button/Button.tsx:42:7`: a root-relative POSIX path, 1-based line and column. */
export function formatSourceLoc(root: string, file: string, line: number, column: number): string {
  const path = isAbsolute(file) ? relative(root, file) : file;
  return `${path.split(sep).join(posix.sep)}:${line}:${column}`;
}

export interface HolotypeVitePluginOptions {
  /** Files to stamp. Default: `.jsx` and `.tsx` outside `node_modules`. */
  readonly include?: RegExp;
}

/**
 * Optional dev-only plugin for branch mode (D-36). It will inject `data-holotype-loc` on
 * host JSX elements, because React 19 removed `_debugSource`. Phase 7.
 */
export function holotype(_options: HolotypeVitePluginOptions = {}): Plugin {
  return { name: 'holotype:jsx-loc', apply: 'serve', enforce: 'pre' };
}
