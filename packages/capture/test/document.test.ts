import { type CaptureDoc, type CNode, type CTextStyle, validateCaptureDoc } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { canonicalCapture, captureHash, stableCapture, VOLATILE_CAPTURE_FIELDS } from '../src';
import { pngSize } from '../src/capture-variant';
import { assembleCaptureDoc, fromPageDiagnostic, rekeyTextStyles, sortDiagnostics, textStyleId } from '../src/document';
import type { PageCapture } from '../src/page/types';

const color = { r: 0, g: 0, b: 0, a: 1, space: 'srgb' as const };
const paint = { stackingContext: false, zIndex: 'auto' as const, layer: 'block' as const, domIndex: 0 };

const style: CTextStyle = {
  cssFamily: 'Inter, sans-serif',
  used: [],
  weight: 500,
  italic: false,
  stretch: '100%',
  size: 12,
  lineHeightPx: 16,
  lineHeightSource: 'explicit',
  letterSpacingPx: 0,
  wordSpacingPx: 0,
  transform: 'none',
  smallCaps: false,
  color,
};

const text: CNode = {
  id: 'c2',
  type: 'text',
  source: { tag: '#text', path: 'span:0>#text:0' },
  borderBox: { x: 8, y: 3, w: 36.609375, h: 16 },
  text: {
    characters: 'Badge',
    runs: [{ start: 0, end: 5, styleId: 's0' }],
    lines: [{ top: 3, height: 16, left: 8, width: 36.609375, startChar: 0, endChar: 5 }],
    whiteSpace: 'nowrap',
    textOverflow: 'clip',
    lineClamp: null,
    wrap: 'nowrap',
    textAlign: 'left',
    indent: 0,
  },
  children: [],
  paint: { ...paint, layer: 'inline', domIndex: 1 },
};

const root: CNode = {
  id: 'c1',
  type: 'element',
  source: { tag: 'span', path: 'span:0' },
  borderBox: { x: 0, y: 1, w: 52.609375, h: 20 },
  computed: {
    display: 'inline-flex',
    position: 'static',
    boxSizing: 'border-box',
    visibility: 'visible',
    zIndex: 'auto',
    opacity: 1,
    mixBlendMode: 'normal',
    isolation: 'auto',
    overflowX: 'visible',
    overflowY: 'visible',
    padding: [2, 8, 2, 8],
    border: { width: [0, 0, 0, 0], style: ['none', 'none', 'none', 'none'], color: [color, color, color, color] },
    margin: [0, 0, 0, 0],
    radius: { h: [9999, 9999, 9999, 9999], v: [9999, 9999, 9999, 9999] },
    background: { color: { r: 0.945, g: 0.96, b: 0.976, a: 1, space: 'srgb' }, layers: [], clip: ['border-box'] },
    boxShadow: [],
    size: { width: 52.609375, height: 20, minW: '0px', maxW: 'none', minH: '0px', maxH: 'none' },
    color,
  },
  children: [text],
  paint,
};

const page: PageCapture = {
  protocol: 2,
  root,
  textStyles: { s0: style },
  diagnostics: [
    { code: 'PAINT_COLOR_READBACK', nodeId: 'c1', property: 'color', value: 'oklch(0.5 0.1 200)' },
    { code: 'CAP_CSS_UNSUPPORTED', nodeId: 'c1', property: 'box-shadow', value: '0 1px red', fallback: 'left out' },
  ],
  serializeMs: 1.25,
};

const target: CaptureDoc['target'] = {
  storybookUrl: 'http://127.0.0.1:6006/iframe.html',
  storyId: 'components-badge--default',
  sid: 'components-badge',
  vk: '791470562c26f81a',
  args: {},
  globals: {},
  state: null,
  viewport: { w: 1280, h: 800 },
  dpr: 2,
  colorScheme: 'light',
  rootSelector: '#storybook-root > :nth-child(1)',
};

const engine = { version: '0.0.0', chromium: '153.0.8010.12', playwright: '1.63.0' };
const sha = 'a'.repeat(64);

function assemble(timing = { renderMs: 120, settleMs: 4, serializeMs: 1.25 }): CaptureDoc {
  return assembleCaptureDoc({
    page,
    engine,
    target,
    timing,
    screenshot: { sha, asset: { mime: 'image/png', bytes: 2492, natural: { w: 106, h: 42 } } },
    diagnostics: [],
  });
}

describe('assembleCaptureDoc', () => {
  it('builds a document that validates', () => {
    const doc = assemble();
    const result = validateCaptureDoc(doc);
    expect(result.ok ? [] : result.error).toEqual([]);
    expect(doc).toMatchObject({
      kind: 'holotype/capture',
      engine: { name: '@holotype/capture', ...engine },
      rootRect: root.borderBox,
      portals: [],
      fonts: [],
      customProperties: { declarations: [] },
      screenshot: { sha },
      assets: { [sha]: { mime: 'image/png', bytes: 2492, natural: { w: 106, h: 42 } } },
    });
  });

  it('keys text styles by content hash and rewrites the runs', () => {
    const doc = assemble();
    const id = textStyleId(style);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(Object.keys(doc.textStyles)).toEqual([id]);
    expect(doc.root.children[0]?.text?.runs).toEqual([{ start: 0, end: 5, styleId: id }]);
  });

  it('renders page diagnostics with the variant scope, in canonical order', () => {
    const doc = assemble();
    expect(doc.diagnostics.map((diag) => diag.code)).toEqual(['CAP_CSS_UNSUPPORTED', 'PAINT_COLOR_READBACK']);
    expect(doc.diagnostics[0]).toMatchObject({
      severity: 'warn',
      nodeKey: 'c1',
      variantKey: target.vk,
      sid: target.sid,
      property: 'box-shadow',
      fallback: 'left out',
    });
  });

  it('leaves the screenshot out when there is none', () => {
    const doc = assembleCaptureDoc({
      page,
      engine,
      target,
      timing: { renderMs: 0, settleMs: 0, serializeMs: 0 },
      diagnostics: [],
    });
    expect(doc.screenshot).toBeUndefined();
    expect(doc.assets).toEqual({});
    expect(validateCaptureDoc(doc).ok).toBe(true);
  });
});

describe('rekeyTextStyles', () => {
  it('gives equal styles one id and rejects runs that name an unknown style', () => {
    const { textStyles } = rekeyTextStyles(root, { s0: style, s1: { ...style } });
    expect(Object.keys(textStyles)).toHaveLength(1);
    expect(() => rekeyTextStyles(root, {})).toThrow(/unknown style "s0"/);
  });
});

describe('fromPageDiagnostic', () => {
  it('renders a catalog diagnostic', () => {
    expect(
      fromPageDiagnostic(
        { code: 'CAP_SR_ONLY_SKIPPED', data: { count: 2, tags: ['span', 'span'] } },
        { vk: 'v', sid: 's' },
      ),
    ).toEqual({
      code: 'CAP_SR_ONLY_SKIPPED',
      severity: 'info',
      message: expect.any(String),
      variantKey: 'v',
      sid: 's',
      data: { count: 2, tags: ['span', 'span'] },
    });
  });
});

describe('sortDiagnostics', () => {
  it('orders by code, node key, message, then the rest', () => {
    const diag = (code: string, nodeKey?: string, value?: string): Diagnostic => ({
      code,
      severity: 'warn',
      message: 'm',
      ...(nodeKey === undefined ? {} : { nodeKey }),
      ...(value === undefined ? {} : { value }),
    });
    const sorted = sortDiagnostics([
      diag('B', 'c1'),
      diag('A', 'c2'),
      diag('A', 'c1', 'y'),
      diag('A', 'c1', 'x'),
      diag('A'),
    ]);
    expect(sorted.map((item) => [item.code, item.nodeKey, item.value])).toEqual([
      ['A', undefined, undefined],
      ['A', 'c1', 'x'],
      ['A', 'c1', 'y'],
      ['A', 'c2', undefined],
      ['B', 'c1', undefined],
    ]);
  });
});

describe('canonical capture and captureHash (05 §10.1)', () => {
  it('rounds numbers per kind and sorts keys', () => {
    const json = canonicalCapture(assemble());
    expect(json).toContain('"w":36.609');
    expect(json).toContain('"b":0.976');
    expect(json.startsWith('{"assets":')).toBe(true);
  });

  it('ignores the volatile timing and nothing else', () => {
    expect(VOLATILE_CAPTURE_FIELDS).toEqual(['timing']);
    const first = assemble({ renderMs: 120, settleMs: 4, serializeMs: 1.25 });
    const second = assemble({ renderMs: 87, settleMs: 9, serializeMs: 2 });
    expect(captureHash(second)).toBe(captureHash(first));
    expect(canonicalCapture(stableCapture(second))).toBe(canonicalCapture(stableCapture(first)));
    expect(validateCaptureDoc(stableCapture(first)).ok).toBe(true);
    const moved = { ...first, rootRect: { ...first.rootRect, x: 1 } };
    expect(captureHash(moved)).not.toBe(captureHash(first));
    expect(captureHash(first)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('pngSize', () => {
  it('reads the IHDR size and rejects other bytes', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 106);
    new DataView(png.buffer).setUint32(20, 42);
    expect(pngSize(png)).toEqual({ w: 106, h: 42 });
    expect(() => pngSize(new Uint8Array(8))).toThrow(/PNG/);
  });
});
