import { type CNode, validateCaptureDoc } from '@holotype/ir';
import { createDiagnostic, diagnostic } from '@holotype/shared';
import type { RenderResult, SbError } from '@holotype/storybook';
import type { ElementHandle, Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENVIRONMENT } from '../src';
import { captureVariant, type VariantContext } from '../src/capture-variant';
import type { PageCapture } from '../src/page/types';
import type { CaptureSession } from '../src/pool/chromium';

/*
 * The per-variant pipeline with a fake page and driver: everything but the browser. The real
 * thing runs in test/e2e.
 */

const color = { r: 0, g: 0, b: 0, a: 1, space: 'srgb' as const };

function rootNode(width = 48): CNode {
  return {
    id: 'c1',
    type: 'element',
    source: { tag: 'div', path: 'div:0' },
    borderBox: { x: 0, y: 0, w: width, h: 32 },
    computed: {
      display: 'block',
      position: 'static',
      boxSizing: 'border-box',
      visibility: 'visible',
      zIndex: 'auto',
      opacity: 1,
      mixBlendMode: 'normal',
      isolation: 'auto',
      overflowX: 'visible',
      overflowY: 'visible',
      padding: [0, 0, 0, 0],
      border: { width: [0, 0, 0, 0], style: ['none', 'none', 'none', 'none'], color: [color, color, color, color] },
      margin: [0, 0, 0, 0],
      radius: { h: [0, 0, 0, 0], v: [0, 0, 0, 0] },
      background: { color, layers: [], clip: ['border-box'] },
      boxShadow: [],
      size: { width, height: 32, minW: 'auto', maxW: 'none', minH: 'auto', maxH: 'none' },
      color,
    },
    children: [],
    paint: { stackingContext: false, zIndex: 'auto', layer: 'block', domIndex: 0 },
  };
}

function pageCapture(root: CNode = rootNode(), protocol = 2): PageCapture {
  return { protocol, root, textStyles: {}, diagnostics: [], serializeMs: 2 };
}

/** A 1×1 PNG header: enough for `pngSize`. */
function png(): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  bytes.writeUInt32BE(96, 16);
  bytes.writeUInt32BE(64, 20);
  return bytes;
}

interface FakeOptions {
  readonly render?: RenderResult | SbError;
  /** The URL of the default successful render. */
  readonly url?: string;
  /** What successive serialize calls return or throw. */
  readonly serialize?: (PageCapture | Error)[];
  readonly frozen?: number;
  readonly broken?: boolean;
}

function fakeSession(options: FakeOptions = {}) {
  const calls = { serialize: 0, screenshot: 0 };
  const results = [...(options.serialize ?? [pageCapture()])];
  const handle = {
    evaluate: async (fn: unknown) => {
      // resolvedRootSelector: the container matches `#storybook-root`, the root is child 1.
      if (String(fn).includes('defaults')) return '#storybook-root';
      if (String(fn).includes('indexOf')) return 1;
      calls.serialize += 1;
      const next = results.shift() ?? pageCapture();
      if (next instanceof Error) throw next;
      return next;
    },
  } as unknown as ElementHandle<Element>;
  const render: RenderResult = {
    ok: true,
    storyId: 'micro-flex--row',
    url: options.url ?? 'http://127.0.0.1:6006/iframe.html?id=micro-flex--row&viewMode=story',
    renderMs: 50,
    phase: 'finished',
    container: { ...handle } as ElementHandle<Element>,
    rootHandles: [handle],
    portalHandles: [],
    warnings: [],
  };
  const page = {
    evaluate: async () => ({ finished: 0, frozen: options.frozen ?? 0 }),
    viewportSize: () => ({ width: 1280, height: 800 }),
    screenshot: async () => {
      calls.screenshot += 1;
      return png();
    },
  } as unknown as Page;
  const session: CaptureSession = {
    page,
    driver: {
      mode: 'url',
      render: async () => options.render ?? render,
      reload: async () => {},
      dispose: async () => {},
    },
    broken: options.broken ?? false,
    close: async () => {},
  };
  return { session, calls };
}

const context: VariantContext = {
  env: DEFAULT_ENVIRONMENT,
  engine: { version: '0.0.0', chromium: '153.0.8010.12', playwright: '1.63.0' },
  origin: 'http://127.0.0.1:6006',
  attempt: 0,
};

describe('captureVariant', () => {
  it('assembles a valid, canonical document with its screenshot', async () => {
    const { session, calls } = fakeSession();
    const outcome = await captureVariant(session, { storyId: 'micro-flex--row' }, context);
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostic));
    expect(validateCaptureDoc(outcome.doc).ok).toBe(true);
    expect(outcome.doc.target).toMatchObject({
      storybookUrl: 'http://127.0.0.1:6006/iframe.html',
      sid: 'micro-flex',
      rootSelector: '#storybook-root > :nth-child(1)',
      viewport: { w: 1280, h: 800 },
    });
    expect(outcome.doc.target.vk).toMatch(/^[0-9a-f]{16}$/);
    expect(outcome.doc.timing).toEqual({ renderMs: 50, settleMs: expect.any(Number), serializeMs: 2 });
    const sha = outcome.doc.screenshot?.sha ?? '';
    expect(outcome.doc.assets[sha]).toEqual({ mime: 'image/png', bytes: 24, natural: { w: 96, h: 64 } });
    expect(outcome.assets.get(sha)?.byteLength).toBe(24);
    expect(calls.screenshot).toBe(1);
  });

  it('names a static build by its origin, so the loopback port does not reach the hash', async () => {
    const statics = { ...context, origin: 'static:storybook-static' };
    const outcomes = await Promise.all(
      [41234, 53111].map(async (port) => {
        const { session } = fakeSession({ url: `http://127.0.0.1:${port}/iframe.html?id=micro-flex--row&args=` });
        const outcome = await captureVariant(session, { storyId: 'micro-flex--row' }, statics);
        if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostic));
        return outcome;
      }),
    );
    expect(outcomes.map((outcome) => outcome.doc.target.storybookUrl)).toEqual([
      'static:storybook-static/iframe.html',
      'static:storybook-static/iframe.html',
    ]);
    expect(outcomes[0]?.hash).toBe(outcomes[1]?.hash);
  });

  it('keeps the planned vk and sid, and can skip the screenshot', async () => {
    const { session, calls } = fakeSession();
    const outcome = await captureVariant(
      session,
      { storyId: 'micro-flex--row', sid: 'micro', vk: '0123456789abcdef', screenshot: false },
      context,
    );
    expect(outcome.ok && outcome.doc.target).toMatchObject({ sid: 'micro', vk: '0123456789abcdef' });
    expect(outcome.ok && outcome.doc.screenshot).toBeUndefined();
    expect(calls.screenshot).toBe(0);
  });

  it('passes a render error through, with the render warnings', async () => {
    const diag = createDiagnostic(diagnostic('SB_STORY_MISSING'), undefined, { value: 'x--y' });
    const { session } = fakeSession({
      render: { ok: false, storyId: 'x--y', code: 'SB_STORY_MISSING', diagnostic: diag, warnings: [] },
    });
    const outcome = await captureVariant(session, { storyId: 'x--y' }, context);
    expect(outcome).toEqual({ ok: false, storyId: 'x--y', diagnostic: diag, warnings: [] });
  });

  it('retries the serializer once, then fails with CAP_SERIALIZE_FAILED', async () => {
    const flaky = fakeSession({ serialize: [new Error('detached'), pageCapture()] });
    expect((await captureVariant(flaky.session, { storyId: 'micro-flex--row' }, context)).ok).toBe(true);
    expect(flaky.calls.serialize).toBe(2);

    const broken = fakeSession({ serialize: [new Error('one'), new Error('two')] });
    const outcome = await captureVariant(broken.session, { storyId: 'micro-flex--row' }, context);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.diagnostic).toMatchObject({
      code: 'CAP_SERIALIZE_FAILED',
      severity: 'error',
      data: { storyId: 'micro-flex--row', errors: ['one', 'two'] },
    });
  });

  it('rethrows serializer errors of a crashed page, for the worker to retry', async () => {
    const { session } = fakeSession({ serialize: [new Error('Target crashed')], broken: true });
    await expect(captureVariant(session, { storyId: 'micro-flex--row' }, context)).rejects.toThrow('Target crashed');
  });

  it('fails on a serializer protocol mismatch and on a document that does not validate', async () => {
    const stale = fakeSession({ serialize: [pageCapture(rootNode(), 1)] });
    const outcome = await captureVariant(stale.session, { storyId: 'micro-flex--row' }, context);
    expect(!outcome.ok && outcome.diagnostic.data).toMatchObject({ expected: 2, actual: 1 });

    const invalid = fakeSession({ serialize: [pageCapture({ ...rootNode(), id: '' })] });
    const rejected = await captureVariant(invalid.session, { storyId: 'micro-flex--row' }, context);
    expect(!rejected.ok && rejected.diagnostic.code).toBe('CAP_SERIALIZE_FAILED');
    expect(!rejected.ok && rejected.diagnostic.data?.issues).toBeDefined();
  });

  it('fails with CAP_NONFINITE_VALUE when a NaN reaches the IR', async () => {
    const { session } = fakeSession({ serialize: [pageCapture(rootNode(Number.NaN))] });
    const outcome = await captureVariant(session, { storyId: 'micro-flex--row', screenshot: false }, context);
    expect(!outcome.ok && outcome.diagnostic).toMatchObject({ code: 'CAP_NONFINITE_VALUE', sid: 'micro-flex' });
  });

  it('records frozen animations and the crash retry', async () => {
    const { session } = fakeSession({ frozen: 2 });
    const outcome = await captureVariant(session, { storyId: 'micro-flex--row' }, { ...context, attempt: 1 });
    if (!outcome.ok) throw new Error('capture failed');
    expect(outcome.doc.diagnostics).toEqual([
      expect.objectContaining({ code: 'CAP_ANIMATION_FROZEN', severity: 'info', data: { count: 2 } }),
    ]);
    expect(outcome.warnings.map((warning) => warning.code)).toEqual(['CAP_PAGE_CRASHED']);
  });
});
