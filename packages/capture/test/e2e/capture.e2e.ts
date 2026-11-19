import { type CaptureDoc, type CNode, validateCaptureDoc } from '@holotype/ir';
import { unwrap } from '@holotype/shared';
import { connectStorybook } from '@holotype/storybook';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Capturer, canonicalCapture, captureHash, createCapturer, stableCapture } from '../../src';
import {
  chromiumPath,
  expectCaptured,
  type FixtureStorybook,
  goldenCapture,
  loopbackOnly,
  openFixtureStorybook,
  watchLoopback,
} from './support';

/**
 * B-11 e2e: the capture pool, environment and serializer against a fresh static build of
 * `fixtures/ds-react`, served on 127.0.0.1, in headless Chromium.
 */

let fixture: FixtureStorybook;
let capturer: Capturer;
const outside: string[] = [];
const pages: Page[] = [];

beforeAll(async () => {
  fixture = await openFixtureStorybook();
  const prepare = loopbackOnly(outside);
  capturer = createCapturer({
    storybook: fixture.storybook,
    workers: 2,
    ...chromiumPath(),
    preparePage: async (page) => {
      pages.push(page);
      await prepare(page);
    },
  });
});

afterAll(async () => {
  await capturer?.close();
  await fixture?.close();
});

const GOLDEN_STORIES = [
  'micro-flex--row',
  'components-badge--default',
  'micro-text--single-line',
  'micro-borders--uniform',
  'micro-text--mixed-inline',
];

function nodes(root: CNode): CNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

describe('determinism (05 §10.1)', () => {
  it('captures micro-flex--row three times with byte-identical canonical IR and one hash', async () => {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(expectCaptured(await capturer.capture({ storyId: 'micro-flex--row' })));
    const canonical = runs.map((run) => canonicalCapture(stableCapture(run.doc)));
    expect(new Set(canonical).size).toBe(1);
    expect(new Set(runs.map((run) => run.hash)).size).toBe(1);
    expect(runs[0]?.hash).toBe(captureHash(runs[2]?.doc as CaptureDoc));
    // The screenshot bytes are part of it.
    expect(new Set(runs.map((run) => run.doc.screenshot?.sha)).size).toBe(1);
  });

  it.each(GOLDEN_STORIES)('%s matches its golden capture, twice', async (storyId) => {
    const first = expectCaptured(await capturer.capture({ storyId }));
    const second = expectCaptured(await capturer.capture({ storyId }));
    expect(second.hash).toBe(first.hash);
    expect(goldenCapture(second.doc)).toBe(goldenCapture(first.doc));
    await expect(goldenCapture(first.doc)).toMatchFileSnapshot(`__golden__/${storyId}.capture.json`);
  });
});

describe('portable captures (06 §2 target.storybookUrl)', () => {
  it('hashes a static build the same on another port, with no favicon console error', async () => {
    const again = unwrap(await connectStorybook({ source: { kind: 'static', dir: fixture.dir } }));
    const faviconLogged: string[] = [];
    // A fresh capturer: its first render is the one the browser's own favicon request lands on.
    // Chromium skips that request while routing is on, so requests are watched, not routed.
    const other = createCapturer({
      storybook: again,
      workers: 1,
      ...chromiumPath(),
      preparePage: (page) => {
        watchLoopback(page, outside);
        page.on('console', (message) => {
          if (message.location().url === new URL('/favicon.ico', again.baseUrl).href) {
            faviconLogged.push(message.text());
          }
        });
      },
    });
    try {
      expect(again.baseUrl).not.toBe(fixture.storybook.baseUrl);
      expect(again.origin).toBe(fixture.storybook.origin);
      const here = expectCaptured(await capturer.capture({ storyId: 'micro-flex--row' }));
      const there = expectCaptured(await other.capture({ storyId: 'micro-flex--row' }));
      expect(here.doc.target.storybookUrl).toBe(`${fixture.storybook.origin}/iframe.html`);
      expect(here.doc.target.storybookUrl).toMatch(/^static:[^/:]+\/iframe\.html$/);
      expect(there.doc.target.storybookUrl).toBe(here.doc.target.storybookUrl);
      expect(there.hash).toBe(here.hash);
      expect(canonicalCapture(stableCapture(there.doc))).toBe(canonicalCapture(stableCapture(here.doc)));
      // The browser did ask for /favicon.ico and logged the 404; the render does not report it.
      await expect.poll(() => faviconLogged.length, { timeout: 5000 }).toBeGreaterThan(0);
      expect(there.warnings).toEqual([]);
      const next = expectCaptured(await other.capture({ storyId: 'components-badge--default' }));
      expect(next.warnings).toEqual([]);
    } finally {
      await other.close();
      await again.close();
    }
  });
});

describe('render drivers (03 §5, B-40)', () => {
  // No React `useId` in these stories: its ids count mounts per page (S-07 Q14, masked by B-41).
  const PARITY: readonly { storyId: string; args?: Record<string, string>; globals?: Record<string, string> }[] = [
    ...GOLDEN_STORIES.map((storyId) => ({ storyId })),
    { storyId: 'components-button--primary', args: { label: 'Parity', variant: 'secondary' } },
    { storyId: 'components-card--default', globals: { theme: 'dark' } },
    { storyId: 'components-card--default' },
    { storyId: 'micro-borders--dashed' },
  ];

  it('captures through one warm channel page per worker, hashing the same as the URL path', async () => {
    const viaUrl = createCapturer({ storybook: fixture.storybook, workers: 1, renderMode: 'url', ...chromiumPath() });
    const channelPages: Page[] = [];
    const viaChannel = createCapturer({
      storybook: fixture.storybook,
      workers: 1,
      ...chromiumPath(),
      preparePage: (page) => {
        channelPages.push(page);
        watchLoopback(page, outside);
      },
    });
    try {
      for (const request of PARITY) {
        const channel = expectCaptured(await viaChannel.capture(request));
        const url = expectCaptured(await viaUrl.capture(request));
        expect(channel.hash, request.storyId).toBe(url.hash);
        expect(channel.warnings).toEqual([]);
      }
      // One page, one document: every variant after the first rendered through the channel.
      expect(channelPages).toHaveLength(1);
      const [page] = channelPages;
      expect(await page?.evaluate(() => '__holotypeSbChannel' in window)).toBe(true);
      expect(new URL(page?.url() ?? 'about:blank').pathname).toBe('/iframe.html');
    } finally {
      await viaChannel.close();
      await viaUrl.close();
    }
  });
});

describe('CaptureDoc', () => {
  it('validates, is canonical and carries its screenshot @2x', async () => {
    const result = expectCaptured(await capturer.capture({ storyId: 'components-badge--default' }));
    expect(validateCaptureDoc(result.doc).ok).toBe(true);
    expect(result.canonical).toBe(canonicalCapture(result.doc));
    const { screenshot, assets, rootRect } = result.doc;
    expect(screenshot).toBeDefined();
    const sha = screenshot?.sha ?? '';
    // The clip covers the root on whole CSS px, at DPR 2.
    const width = Math.ceil(rootRect.x + rootRect.w) - Math.floor(rootRect.x);
    const height = Math.ceil(rootRect.y + rootRect.h) - Math.floor(rootRect.y);
    expect(assets[sha]).toMatchObject({ mime: 'image/png', natural: { w: width * 2, h: height * 2 } });
    expect(result.assets.get(sha)?.byteLength).toBe(assets[sha]?.bytes);
    expect(result.doc.target).toMatchObject({
      storyId: 'components-badge--default',
      sid: 'components-badge',
      dpr: 2,
      viewport: { w: 1280, h: 800 },
      colorScheme: 'light',
      rootSelector: '#storybook-root > :nth-child(1)',
      state: null,
    });
    expect(result.doc.engine.chromium).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('records element rects, background, border, radius and opacity', async () => {
    const { doc } = expectCaptured(await capturer.capture({ storyId: 'micro-flex--row' }));
    const [container, ...items] = nodes(doc.root);
    expect(container?.computed).toMatchObject({ display: 'flex', padding: [8, 8, 8, 8], opacity: 1 });
    expect(items.map((item) => item.borderBox)).toEqual([
      { x: 8, y: 8, w: 48, h: 32 },
      { x: 56, y: 8, w: 48, h: 32 },
      { x: 104, y: 8, w: 48, h: 32 },
    ]);
    // #3b82f6
    expect(items[0]?.computed?.background.color).toEqual({
      r: 0.231373,
      g: 0.509804,
      b: 0.964706,
      a: 1,
      space: 'srgb',
    });

    const bordered = expectCaptured(await capturer.capture({ storyId: 'micro-borders--uniform' })).doc.root;
    expect(bordered.computed?.border.style).toEqual(['solid', 'solid', 'solid', 'solid']);
    expect(bordered.computed?.border.width).toEqual([2, 2, 2, 2]);
    expect(bordered.computed?.border.color[0]).toMatchObject({ r: 0.058824, g: 0.090196, b: 0.164706, a: 1 });

    const corners = expectCaptured(await capturer.capture({ storyId: 'micro-borders--radius-per-corner' })).doc.root;
    expect(corners.computed?.radius).toEqual({ h: [0, 8, 16, 24], v: [0, 8, 16, 24] });
  });

  it('records text runs with family, size, weight, color and line boxes that match the layout', async () => {
    const { doc } = expectCaptured(await capturer.capture({ storyId: 'micro-text--single-line' }));
    const [text] = doc.root.children;
    expect(text?.type).toBe('text');
    expect(text?.text?.characters).toBe('The quick brown fox jumps over the lazy dog');
    expect(text?.text?.lines).toHaveLength(1);
    // The line box starts at the paragraph's content box (line-height half-leading, 05 §4.2).
    expect(text?.borderBox.y).toBe(doc.root.borderBox.y);
    expect(text?.borderBox.h).toBe(doc.root.borderBox.h);
    const style = doc.textStyles[text?.text?.runs[0]?.styleId ?? ''];
    expect(style).toMatchObject({ cssFamily: expect.stringContaining('Inter'), lineHeightSource: 'explicit' });
    expect(style?.size).toBeGreaterThan(0);
    expect(style?.weight).toBe(400);

    const paragraph = expectCaptured(await capturer.capture({ storyId: 'micro-text--wrap-paragraph' })).doc;
    const block = paragraph.root.children[0]?.text;
    expect(block?.lines.length).toBeGreaterThan(1);
    // Lines tile the characters; soft wraps keep their space.
    expect(block?.lines[0]?.startChar).toBe(0);
    expect(block?.lines.at(-1)?.endChar).toBe(block?.characters.length);
    expect(block?.characters).not.toMatch(/\S{2,}\s{2,}|\w\.\w/);
    expect(block?.characters).toContain('container width, and');
  });

  it('collapses whitespace across inline elements and reports their paint', async () => {
    const { doc } = expectCaptured(await capturer.capture({ storyId: 'micro-text--mixed-inline' }));
    const text = doc.root.children[0]?.text;
    expect(text?.characters).toBe(
      'Plain text, bold text, accent color, highlighted and smaller medium in one paragraph.',
    );
    expect(text?.runs.length).toBeGreaterThan(1);
    const weights = new Set(text?.runs.map((run) => doc.textStyles[run.styleId]?.weight));
    expect(weights.has(700) || weights.has(600)).toBe(true);
    expect(doc.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'CAP_CSS_UNSUPPORTED', property: 'background-color', data: { inline: 'mark' } }),
    );
  });

  it('reports content it does not capture yet instead of dropping it silently', async () => {
    const { doc } = expectCaptured(await capturer.capture({ storyId: 'components-button--with-icon' }));
    const svg = nodes(doc.root).find((node) => node.source.tag === 'svg');
    expect(svg?.children).toEqual([]);
    expect(doc.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'CAP_CSS_UNSUPPORTED', nodeKey: svg?.id, value: 'svg', severity: 'warn' }),
    );
    const oklch = expectCaptured(await capturer.capture({ storyId: 'micro-backgrounds--oklch' })).doc;
    expect(oklch.root.computed?.background.color.original).toMatch(/^oklch\(/);
    expect(oklch.diagnostics.map((diag) => diag.code)).toContain('PAINT_COLOR_READBACK');
  });
});

describe('environment (D-24)', () => {
  it('freezes the clock, seeds Math.random and pins the context', async () => {
    expectCaptured(await capturer.capture({ storyId: 'components-badge--default' }));
    const page = pages.find((candidate) => !candidate.isClosed() && candidate.url().includes('components-badge'));
    if (page === undefined) throw new Error('no page rendered the badge');
    const facts = await page.evaluate(() => ({
      now: Date.now(),
      iso: new Date().toISOString(),
      random: [Math.random(), Math.random(), Math.random()],
      seeded: !Math.random.toString().includes('[native code]'),
      userAgent: navigator.userAgent,
      dpr: devicePixelRatio,
      viewport: [innerWidth, innerHeight],
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
      bodyPadding: getComputedStyle(document.body).paddingTop,
    }));
    expect(facts.now).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(facts.iso).toBe('2026-01-01T00:00:00.000Z');
    expect(facts.seeded).toBe(true);
    expect(facts.random.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(facts.userAgent).toMatch(/StorybookTestRunner holotype\/\d/);
    expect(facts).toMatchObject({
      dpr: 2,
      viewport: [1280, 800],
      reducedMotion: true,
      dark: false,
      timeZone: 'UTC',
      locale: 'en-US',
      bodyPadding: '0px',
    });
  });

  it('gives every new document the same Math.random sequence', async () => {
    const page = pages.find((candidate) => !candidate.isClosed());
    if (page === undefined) throw new Error('no capture page');
    const read = () => page.evaluate(() => [Math.random(), Math.random()]);
    await page.reload();
    const first = await read();
    await page.reload();
    expect(await read()).toEqual(first);
  });
});

describe('pool (05 §1.1)', () => {
  it('runs captures of several components concurrently on its workers', async () => {
    expect(capturer.workers).toBe(2);
    const ids = ['components-card--default', 'components-input--default', 'micro-flex--column', 'micro-flex--gap'];
    const outcomes = await Promise.all(ids.map((storyId) => capturer.capture({ storyId })));
    expect(outcomes.map((outcome) => outcome.ok && outcome.storyId)).toEqual(ids);
    const [first] = outcomes;
    if (first === undefined) throw new Error('no outcome');
    const again = expectCaptured(await capturer.capture({ storyId: 'components-card--default' }));
    expect(again.hash).toBe(expectCaptured(first).hash);
  });

  it('returns the render error of a story that is not in the index', async () => {
    const outcome = await capturer.capture({ storyId: 'components-badge--no-such-story' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.diagnostic.code).toBe('SB_STORY_MISSING');
  });

  it('recovers from a page crash: retries once on a fresh page with CAP_PAGE_CRASHED', async () => {
    let crashed = false;
    const crashing = createCapturer({
      storybook: fixture.storybook,
      workers: 1,
      ...chromiumPath(),
      preparePage: async (page) => {
        await loopbackOnly(outside)(page);
        await page.route('**/assets/Badge.stories-*.js', async (route) => {
          if (crashed) return route.fallback();
          crashed = true;
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Page.crash').catch(() => undefined);
        });
      },
    });
    try {
      const outcome = expectCaptured(await crashing.capture({ storyId: 'components-badge--default' }));
      expect(crashed).toBe(true);
      expect(outcome.warnings.map((warning) => warning.code)).toContain('CAP_PAGE_CRASHED');
      const clean = expectCaptured(await capturer.capture({ storyId: 'components-badge--default' }));
      expect(outcome.hash).toBe(clean.hash);
    } finally {
      await crashing.close();
    }
  });

  it('rejects captures after close()', async () => {
    const closed = createCapturer({ storybook: fixture.storybook, workers: 1, ...chromiumPath() });
    await closed.close();
    await expect(closed.capture({ storyId: 'micro-flex--row' })).rejects.toThrow(/closed/);
  });

  it('made no request outside 127.0.0.1', () => {
    expect(outside).toEqual([]);
  });
});
