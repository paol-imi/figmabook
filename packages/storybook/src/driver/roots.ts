/// <reference lib="dom" />
import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import type { ElementHandle, JSHandle, Page } from 'playwright';
import type { RenderRequest } from '../types';
import { scopeOf } from './errors';
import { checkStability, findRootContainer, type PaintedWrapper, resolveRoots } from './page-scripts';

/** Root containers, in order (03 §6.1): SB ≥7, then older builds. */
export const DEFAULT_ROOT_SELECTORS: readonly string[] = ['#storybook-root', '#root'];

/** Decorator wrappers unwrapped at most (a backstop; real stories have a handful). */
export const MAX_UNWRAP_DEPTH = 32;

/** The stability check: pairs of samples 100 ms apart, three tries (03 §5.5 step 8). */
export const STABILITY = { tries: 3, intervalMs: 100, maxElements: 2000 } as const;

/** The selectors of a request's root container. */
export const rootSelectors = (request: RenderRequest): readonly string[] =>
  request.rootSelector === undefined ? DEFAULT_ROOT_SELECTORS : [request.rootSelector];

/** `unwrap` as a depth: `false` → 0, `true` or unset → {@link MAX_UNWRAP_DEPTH}. */
export function unwrapDepth(unwrap: boolean | number | undefined): number {
  if (unwrap === false) return 0;
  if (unwrap === undefined || unwrap === true) return MAX_UNWRAP_DEPTH;
  return Math.max(0, Math.min(MAX_UNWRAP_DEPTH, Math.floor(unwrap)));
}

export interface FoundRoots {
  readonly container: ElementHandle<Element>;
  readonly rootHandles: ElementHandle<Element>[];
  /** `SB_DECORATOR_PAINTS` for painted provider wrappers that were unwrapped. */
  readonly warnings: Diagnostic[];
}

/**
 * Finds the root container and the story's roots in it (03 §6.1–6.2). `undefined` when no
 * selector matches (`SB_ROOT_NOT_FOUND`).
 */
export async function findRoots(page: Page, request: RenderRequest): Promise<FoundRoots | undefined> {
  const found = await page.evaluateHandle(findRootContainer, rootSelectors(request));
  const container = found.asElement();
  if (container === null) {
    await found.dispose();
    return undefined;
  }
  const element = container as ElementHandle<Element>;
  const resolved = await element.evaluateHandle(resolveRoots, unwrapDepth(request.unwrap));
  const rootHandles = await arrayElements(await resolved.getProperty('roots'));
  const painted = (await (await resolved.getProperty('painted')).jsonValue()) as PaintedWrapper[];
  await resolved.dispose();
  const warnings = painted.map((wrapper) =>
    createDiagnostic(diagnostic('SB_DECORATOR_PAINTS'), undefined, {
      ...scopeOf(request.storyId),
      value: wrapper.background,
      data: { storyId: request.storyId, path: wrapper.path, background: wrapper.background },
    }),
  );
  return { container: element, rootHandles, warnings };
}

/** The element handles of an in-page array, in index order. Non-elements are dropped. */
async function arrayElements(list: JSHandle): Promise<ElementHandle<Element>[]> {
  const properties = await list.getProperties();
  const handles: ElementHandle<Element>[] = [];
  const indexed = [...properties.entries()]
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([a], [b]) => Number(a) - Number(b));
  for (const [, property] of indexed) {
    const element = property.asElement();
    if (element === null) await property.dispose();
    else handles.push(element as ElementHandle<Element>);
  }
  await list.dispose();
  return handles;
}

/** Runs the stability check; `CAP_UNSTABLE_RENDER` when the root kept changing. */
export async function stabilityWarning(page: Page, request: RenderRequest): Promise<Diagnostic | undefined> {
  const report = await page.evaluate(checkStability, { selectors: rootSelectors(request), ...STABILITY });
  if (report.stable) return undefined;
  return createDiagnostic(diagnostic('CAP_UNSTABLE_RENDER'), undefined, {
    ...scopeOf(request.storyId),
    data: { storyId: request.storyId, tries: report.tries, intervalMs: STABILITY.intervalMs },
  });
}
