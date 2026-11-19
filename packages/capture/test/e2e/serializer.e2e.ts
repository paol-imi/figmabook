import type { CNode } from '@holotype/ir';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CHROMIUM_ARGS,
  type PageCapture,
  type PageSerializer,
  type SerializeOptions,
  serializerSource,
} from '../../src';
import { chromiumPath } from './support';

/**
 * The page serializer on hand-written HTML (no Storybook): the walk's edge cases, in the
 * same Chromium and flags as the capturer.
 */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  const { chromiumPath: executablePath } = chromiumPath();
  browser = await chromium.launch({
    ...(executablePath === undefined ? { channel: 'chromium' } : { executablePath }),
    args: [...CHROMIUM_ARGS],
  });
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 800, height: 600 } });
  await context.addInitScript({ content: serializerSource });
  // Tests talk only to 127.0.0.1 (BUILD §3.1 rule 8): no request leaves the page.
  await context.route('**/*', (route) => route.abort('blockedbyclient'));
  page = await context.newPage();
});

afterAll(async () => {
  await browser?.close();
});

async function serialize(html: string, options: SerializeOptions = {}): Promise<PageCapture> {
  await page.setContent(`<!doctype html><html><body style="margin:0;font:16px/20px sans-serif">${html}</body></html>`);
  return page.evaluate((opts) => {
    const api = (globalThis as { __holotype?: PageSerializer }).__holotype;
    const root = document.querySelector('#root');
    if (api === undefined || root === null) throw new Error('no serializer or no #root');
    return api.serialize(root, opts);
  }, options);
}

const flat = (node: CNode): CNode[] => [node, ...node.children.flatMap(flat)];
const texts = (capture: PageCapture) =>
  flat(capture.root)
    .filter((node) => node.type === 'text')
    .map((node) => node.text?.characters);

describe('page serializer', () => {
  it('assigns ids and domIndex in walk order and structural paths per tag', async () => {
    const capture = await serialize('<div id="root"><span>a</span><div></div><div><b>c</b></div>text</div>');
    const nodes = flat(capture.root);
    expect(nodes.map((node) => node.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    expect(nodes.map((node) => node.paint.domIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(nodes.map((node) => node.source.path)).toEqual([
      'div:0',
      'div:0>#text:0',
      'div:0>div:0',
      'div:0>div:1',
      'div:0>div:1>#text:0',
      'div:0>#text:1',
    ]);
    // The inline <span> joined the first text block; <b> joined the inner div's.
    expect(texts(capture)).toEqual(['a', 'c', 'text']);
  });

  it('skips hidden, ignored, excluded and visually-hidden content', async () => {
    const capture = await serialize(
      `<div id="root">
        <p style="display:none">none</p>
        <p data-holotype-ignore>ignored</p>
        <p class="skip">excluded</p>
        <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">sr only</span>
        <script>1</script><template><p>t</p></template>
        <p>kept</p>
      </div>`,
      { exclude: ['.skip'] },
    );
    expect(texts(capture)).toEqual(['kept']);
    expect(capture.diagnostics).toContainEqual({ code: 'CAP_SR_ONLY_SKIPPED', data: { count: 1, tags: ['span'] } });
  });

  it('splices display: contents and walks open shadow roots with their slots', async () => {
    await page.setContent('<div id="root"><x-card><span>slotted</span></x-card></div>');
    const capture = await page.evaluate(() => {
      const host = document.querySelector('x-card');
      const shadow = host?.attachShadow({ mode: 'open' });
      if (shadow) shadow.innerHTML = '<div class="frame"><slot></slot></div>';
      const root = document.querySelector('#root');
      const api = (globalThis as { __holotype?: PageSerializer }).__holotype;
      if (!root || !api) throw new Error('setup');
      return api.serialize(root);
    });
    const paths = flat(capture.root).map((node) => node.source.path);
    expect(paths).toContain('div:0>x-card:0::shadow>div:0');
    expect(texts(capture)).toEqual(['slotted']);
    const frame = flat(capture.root).find((node) => node.source.classes?.includes('frame'));
    expect(frame?.source.inShadow).toBe(true);

    const contents = await serialize('<div id="root"><div style="display:contents"><p>one</p><p>two</p></div></div>');
    expect(contents.root.children.map((node) => node.source.path)).toEqual(['div:0>p:0', 'div:0>p:1']);
  });

  it('keeps <br> as U+2028 and preserved whitespace under white-space: pre', async () => {
    const capture = await serialize(
      '<div id="root"><p>one<br>two</p><pre style="font:16px/20px monospace;margin:0">a  b\nc</pre></div>',
    );
    expect(texts(capture)).toEqual([`one${String.fromCharCode(0x2028)}two`, 'a  b\nc']);
    const pre = flat(capture.root).find((node) => node.text?.characters.startsWith('a'));
    expect(pre?.text?.lines).toHaveLength(2);
    expect(pre?.text?.whiteSpace).toBe('pre');
  });

  it('blockifies the children of a flex container', async () => {
    const capture = await serialize('<div id="root" style="display:flex"><span>a</span>loose<b>c</b></div>');
    expect(capture.root.children.map((node) => [node.type, node.source.tag])).toEqual([
      ['element', 'span'],
      ['text', '#text'],
      ['element', 'b'],
    ]);
  });

  it('measures line-height: normal with a probe and resolves percentage radii', async () => {
    const capture = await serialize(
      '<div id="root" style="width:100px;height:40px;border-radius:50%;line-height:normal">Hi</div>',
    );
    expect(capture.root.computed?.radius).toEqual({ h: [50, 50, 50, 50], v: [20, 20, 20, 20] });
    const [style] = Object.values(capture.textStyles);
    expect(style?.lineHeightSource).toBe('normal-probed');
    expect(style?.lineHeightPx).toBeGreaterThan(16);
    // The probe left no trace.
    expect(await page.evaluate(() => document.body.childElementCount)).toBe(1);
  });

  it('reports what it does not capture yet', async () => {
    const capture = await serialize(
      `<style>#root::before{content:"x"} .t{text-decoration:underline;text-shadow:0 1px red}</style>
       <div id="root" style="box-shadow:0 1px 2px red;transform:rotate(1deg);background-image:linear-gradient(red,blue);border-radius:calc(10% + 2px)">
         <span class="t">deco</span><img alt="">
       </div>`,
    );
    const codes = capture.diagnostics.map((diag) => `${diag.code}:${diag.property ?? diag.value ?? ''}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'CAP_CSS_UNSUPPORTED:box-shadow',
        'CAP_CSS_UNSUPPORTED:transform',
        'CAP_CSS_UNSUPPORTED:background-image',
        'CAP_CSS_UNSUPPORTED:border-top-left-radius',
        'CAP_CSS_UNSUPPORTED:text-decoration',
        'CAP_CSS_UNSUPPORTED:text-shadow',
        'CAP_CSS_UNSUPPORTED:replaced-content',
        'CAP_PSEUDO_UNMEASURED:::before',
      ]),
    );
    expect(capture.root.computed?.boxShadow).toEqual([]);
    expect(capture.root.computed?.radius.h).toEqual([0, 0, 0, 0]);
  });

  it('records raw effects, outlines and per-side borders', async () => {
    const capture = await serialize(
      `<div id="root" style="filter:blur(2px);clip-path:inset(1px);opacity:0.5;outline:2px dashed rgb(255, 0, 0);outline-offset:3px;
        border-style:solid;border-width:1px 2px 3px 4px;border-color:red green blue black"></div>`,
    );
    const { computed, paint } = capture.root;
    expect(computed).toMatchObject({
      filter: 'blur(2px)',
      clipPath: 'inset(1px)',
      opacity: 0.5,
      outline: { width: 2, style: 'dashed', offset: 3, color: { r: 1, g: 0, b: 0, a: 1 } },
      border: { width: [1, 2, 3, 4], style: ['solid', 'solid', 'solid', 'solid'] },
    });
    expect(computed?.border.color.map((color) => [color.r, color.g, color.b])).toEqual([
      [1, 0, 0],
      [0, 128 / 255, 0],
      [0, 0, 1],
      [0, 0, 0],
    ]);
    expect(paint.stackingContext).toBe(true);
  });

  it('throws on an invalid exclude selector (the capturer reports CAP_SERIALIZE_FAILED)', async () => {
    await expect(serialize('<div id="root"><p>x</p></div>', { exclude: ['::not a selector('] })).rejects.toThrow();
  });
});
