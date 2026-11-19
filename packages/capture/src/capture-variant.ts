/*
 * The per-variant pipeline (05 §1.2), v0 subset: render and settle (03 §5), finish
 * animations, serialize in the page, screenshot the root, then assemble, validate,
 * canonicalize and hash.
 */
import { createHash } from 'node:crypto';
import { type CaptureDoc, type JsonValue, type Rect, validateCaptureDoc, variantKey } from '@holotype/ir';
import { createDiagnostic, type Diagnostic, diagnostic, HolotypeError } from '@holotype/shared';
import { componentIdFromStoryId, DEFAULT_ROOT_SELECTORS, documentUrl, type RenderResult } from '@holotype/storybook';
import type { ElementHandle, Page } from 'playwright';
import { canonicalCapture, captureHash } from './canonical';
import { assembleCaptureDoc, type ScreenshotAsset } from './document';
import type { CaptureEnvironment } from './environment';
import type { PageSerializer } from './page/serializer';
import { type PageCapture, SERIALIZER_PROTOCOL, type SerializeOptions } from './page/types';
import type { CaptureSession } from './pool/chromium';
import { settleAnimations } from './settle';
import type { CaptureFailure, CaptureOutcome, CaptureRequest } from './types';

export interface EngineInfo {
  readonly version: string;
  readonly chromium: string;
  readonly playwright: string;
}

export interface VariantContext {
  readonly env: CaptureEnvironment;
  readonly engine: EngineInfo;
  /** The Storybook's `origin` (`ConnectedStorybook.origin`): `target.storybookUrl` is this origin plus the render path. */
  readonly origin: string;
  /** 1 on the retry after a page crash (`CAP_PAGE_CRASHED`). */
  readonly attempt: number;
}

/** The PNG size from its IHDR chunk. */
export function pngSize(bytes: Uint8Array): { w: number; h: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 24 || view.getUint32(12) !== 0x49484452) throw new Error('Not a PNG: no IHDR chunk.');
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function failure(storyId: string, diag: Diagnostic, warnings: readonly Diagnostic[]): CaptureFailure {
  return { ok: false, storyId, diagnostic: diag, warnings };
}

function serializeFailed(storyId: string, scope: { vk: string; sid: string }, data: Record<string, unknown>) {
  return createDiagnostic(diagnostic('CAP_SERIALIZE_FAILED'), undefined, {
    variantKey: scope.vk,
    sid: scope.sid,
    data: { storyId, ...data },
  });
}

/**
 * The selector of the capture root as resolved (05 §13 `target.rootSelector`): the container,
 * then one `:nth-child` step per level down to the root (decorator wrappers unwrapped, 03 §6.2).
 */
async function resolvedRootSelector(render: RenderResult, root: ElementHandle<Element>, requested?: string) {
  const container =
    requested ??
    (await render.container.evaluate(
      (el, defaults) => defaults.find((selector) => el.matches(selector)) ?? el.localName,
      [...DEFAULT_ROOT_SELECTORS],
    ));
  if (root === render.container) return container;
  const steps = await root.evaluate((el, top) => {
    const path: number[] = [];
    for (let node: Element | null = el; node !== null && node !== top; node = node.parentElement) {
      path.unshift([...(node.parentElement?.children ?? [])].indexOf(node) + 1);
    }
    return path;
  }, render.container);
  return [container, ...steps.map((index) => `:nth-child(${index})`)].join(' > ');
}

/**
 * A PNG of the capture root at the context DPR (fidelity harness, 12): the clip covers the
 * root rect on whole CSS px. `undefined` for an empty root.
 */
async function screenshotRoot(page: Page, rect: Rect, env: CaptureEnvironment) {
  if (rect.w <= 0 || rect.h <= 0) return undefined;
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const width = Math.ceil(rect.x + rect.w) - x;
  const height = Math.ceil(rect.y + rect.h) - y;
  const viewport = page.viewportSize() ?? env.viewport;
  const bytes = await page.screenshot({
    type: 'png',
    clip: { x, y, width, height },
    fullPage: x + width > viewport.width || y + height > viewport.height,
    animations: 'disabled',
    caret: 'hide',
    scale: 'device',
  });
  const natural = pngSize(bytes);
  const shot: ScreenshotAsset = { sha: sha256(bytes), asset: { mime: 'image/png', bytes: bytes.byteLength, natural } };
  return { shot, bytes: new Uint8Array(bytes) };
}

/** Captures one variant on a worker session. */
export async function captureVariant(
  session: CaptureSession,
  request: CaptureRequest,
  context: VariantContext,
): Promise<CaptureOutcome> {
  const { page, driver } = session;
  const { env } = context;
  const { storyId } = request;
  const args: Record<string, JsonValue> = { ...request.args };
  const globals: Record<string, JsonValue> = { ...request.globals };
  const viewport = request.viewport ?? env.viewport;
  const sid = request.sid ?? componentIdFromStoryId(storyId);
  const vk =
    request.vk ??
    variantKey({ storyId, args, globals, state: null, viewport: { w: viewport.width, h: viewport.height } });
  const scope = { vk, sid };
  const warnings: Diagnostic[] = [];
  if (context.attempt > 0) {
    warnings.push(
      createDiagnostic(diagnostic('CAP_PAGE_CRASHED'), undefined, { variantKey: vk, sid, data: { storyId } }),
    );
  }

  const render = await driver.render({
    storyId,
    args,
    globals,
    viewport,
    ...(request.rootSelector === undefined ? {} : { rootSelector: request.rootSelector }),
    ...(request.keepLayout === undefined ? {} : { keepLayout: request.keepLayout }),
    ...(request.unwrap === undefined ? {} : { unwrap: request.unwrap }),
  });
  warnings.push(...render.warnings);
  if (!render.ok) return failure(storyId, render.diagnostic, warnings);

  const settleStarted = performance.now();
  const settled = await page.evaluate(settleAnimations, env.animations);
  const settleMs = performance.now() - settleStarted;
  const factDiagnostics: Diagnostic[] = [];
  if (settled.frozen > 0) {
    factDiagnostics.push(
      createDiagnostic(diagnostic('CAP_ANIMATION_FROZEN'), undefined, {
        variantKey: vk,
        sid,
        data: { count: settled.frozen },
      }),
    );
  }

  // One rendered root is the story root; several (fragments) are captured through their container.
  const [single] = render.rootHandles;
  const root = render.rootHandles.length === 1 && single !== undefined ? single : render.container;
  const options: SerializeOptions = request.exclude === undefined ? {} : { exclude: [...request.exclude] };
  // The serializer is retried once; a second throw fails the variant (CAP_SERIALIZE_FAILED).
  let captured: PageCapture | undefined;
  const errors: string[] = [];
  while (captured === undefined && errors.length < 2) {
    try {
      captured = await root.evaluate((el, opts) => {
        const api = (globalThis as { __holotype?: PageSerializer }).__holotype;
        if (api === undefined) throw new Error('The Holotype serializer is not installed in this page.');
        return api.serialize(el, opts);
      }, options);
    } catch (error) {
      if (session.broken) throw error;
      errors.push((error as Error).message);
    }
  }
  if (captured === undefined) return failure(storyId, serializeFailed(storyId, scope, { errors }), warnings);
  if (captured.protocol !== SERIALIZER_PROTOCOL) {
    const data = { expected: SERIALIZER_PROTOCOL, actual: captured.protocol };
    return failure(storyId, serializeFailed(storyId, scope, data), warnings);
  }

  const target: CaptureDoc['target'] = {
    // A portable URL: a static build's ephemeral port would change the hash on every run.
    storybookUrl: documentUrl(render.url, context.origin),
    storyId,
    sid,
    vk,
    args,
    globals,
    state: null,
    viewport: { w: viewport.width, h: viewport.height },
    dpr: env.dpr,
    colorScheme: env.colorScheme,
    rootSelector: await resolvedRootSelector(render, root, request.rootSelector),
  };
  const assets = new Map<string, Uint8Array>();
  let screenshot: ScreenshotAsset | undefined;
  if (request.screenshot !== false) {
    const taken = await screenshotRoot(page, captured.root.borderBox, env);
    if (taken !== undefined) {
      screenshot = taken.shot;
      assets.set(taken.shot.sha, taken.bytes);
    }
  }
  const assembled = assembleCaptureDoc({
    page: captured,
    engine: context.engine,
    target,
    timing: { renderMs: render.renderMs, settleMs, serializeMs: captured.serializeMs },
    diagnostics: factDiagnostics,
    ...(screenshot === undefined ? {} : { screenshot }),
  });

  let canonical: string;
  try {
    canonical = canonicalCapture(assembled);
  } catch (error) {
    // A NaN or Infinity reached the IR: canonicalJSON throws CAP_NONFINITE_VALUE (06 §5).
    const [nonFinite] = error instanceof HolotypeError ? error.diagnostics : [];
    if (nonFinite === undefined) throw error;
    return failure(storyId, { ...nonFinite, variantKey: vk, sid }, warnings);
  }
  const doc = JSON.parse(canonical) as CaptureDoc;
  const valid = validateCaptureDoc(doc);
  if (!valid.ok) return failure(storyId, serializeFailed(storyId, scope, { issues: valid.error }), warnings);
  return { ok: true, storyId, doc: valid.value, canonical, hash: captureHash(valid.value), assets, warnings };
}
