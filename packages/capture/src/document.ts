/*
 * Assembles the `CaptureDoc` (06 §2, fill contract 05 §13) from what the page serialized and
 * what Node knows about the run.
 */
import {
  CAPTURE_VERSION,
  type CAsset,
  type CaptureDoc,
  type CNode,
  type CTextStyle,
  canonicalJSON,
  captureNumKind,
  h16,
} from '@holotype/ir';
import { createDiagnostic, type Diagnostic, type DiagnosticCode, diagnostic } from '@holotype/shared';
import type { PageCapture, PageDiagnostic, PageDiagnosticCode } from './page/types';

// Every code the page emits is a catalog code (12 §6.2).
const pageCodesAreRegistered: PageDiagnosticCode extends DiagnosticCode ? true : never = true;
void pageCodesAreRegistered;

/** Where a diagnostic of this variant applies. */
export interface VariantScope {
  readonly vk: string;
  readonly sid: string;
}

/** A page diagnostic as a catalog diagnostic of the variant. */
export function fromPageDiagnostic(page: PageDiagnostic, scope: VariantScope): Diagnostic {
  return createDiagnostic(diagnostic(page.code), undefined, {
    variantKey: scope.vk,
    sid: scope.sid,
    ...(page.nodeId === undefined ? {} : { nodeKey: page.nodeId }),
    ...(page.property === undefined ? {} : { property: page.property }),
    ...(page.value === undefined ? {} : { value: page.value }),
    ...(page.fallback === undefined ? {} : { fallback: page.fallback }),
    ...(page.data === undefined ? {} : { data: page.data }),
  });
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Diagnostics in canonical order (06 §5): by code, node key, message, then the rest. */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const keyed = diagnostics.map((item) => ({ item, rest: canonicalJSON(item) }));
  keyed.sort(
    (a, b) =>
      compare(a.item.code, b.item.code) ||
      compare(a.item.nodeKey ?? '', b.item.nodeKey ?? '') ||
      compare(a.item.message, b.item.message) ||
      compare(a.rest, b.rest),
  );
  return keyed.map(({ item }) => item);
}

/** The id of a text style: `h16` of its canonical JSON, so equal styles share an id across documents. */
export function textStyleId(style: CTextStyle): string {
  return h16(canonicalJSON(style, { numKind: captureNumKind }));
}

/** Re-keys the page-local text style ids by content hash, in the styles and in every run. */
export function rekeyTextStyles(
  root: CNode,
  pageStyles: Readonly<Record<string, CTextStyle>>,
): { root: CNode; textStyles: Record<string, CTextStyle> } {
  const ids = new Map<string, string>();
  const textStyles: Record<string, CTextStyle> = {};
  for (const [pageId, style] of Object.entries(pageStyles)) {
    const id = textStyleId(style);
    ids.set(pageId, id);
    textStyles[id] = style;
  }
  const rekey = (node: CNode): CNode => {
    const children = node.children.map(rekey);
    if (node.text === undefined) return { ...node, children };
    const runs = node.text.runs.map((run) => {
      const styleId = ids.get(run.styleId);
      if (styleId === undefined) throw new Error(`Text run of ${node.id} names an unknown style "${run.styleId}".`);
      return { ...run, styleId };
    });
    return { ...node, text: { ...node.text, runs }, children };
  };
  return { root: rekey(root), textStyles };
}

export interface ScreenshotAsset {
  readonly sha: string;
  readonly asset: CAsset;
}

export interface AssembleInput {
  readonly page: PageCapture;
  readonly engine: { readonly version: string; readonly chromium: string; readonly playwright: string };
  readonly target: CaptureDoc['target'];
  readonly timing: CaptureDoc['timing'];
  readonly screenshot?: ScreenshotAsset;
  /** Node-side diagnostics that are facts of this capture (e.g. `CAP_ANIMATION_FROZEN`). */
  readonly diagnostics: readonly Diagnostic[];
}

/** Builds the document. Fields this version does not capture yet are empty (05 §13). */
export function assembleCaptureDoc(input: AssembleInput): CaptureDoc {
  const { page, target, screenshot } = input;
  const scope: VariantScope = { vk: target.vk, sid: target.sid };
  const { root, textStyles } = rekeyTextStyles(page.root, page.textStyles);
  const diagnostics = sortDiagnostics([
    ...page.diagnostics.map((item) => fromPageDiagnostic(item, scope)),
    ...input.diagnostics,
  ]);
  return {
    kind: 'holotype/capture',
    captureVersion: CAPTURE_VERSION,
    engine: { name: '@holotype/capture', ...input.engine },
    target,
    timing: input.timing,
    rootRect: root.borderBox,
    root,
    portals: [],
    textStyles,
    assets: screenshot === undefined ? {} : { [screenshot.sha]: screenshot.asset },
    fonts: [],
    customProperties: { declarations: [] },
    ...(screenshot === undefined ? {} : { screenshot: { sha: screenshot.sha } }),
    diagnostics,
  };
}
