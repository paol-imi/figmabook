import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkStability } from '../../src/driver/page-scripts';
import { findRoots, STABILITY } from '../../src/driver/roots';
import { launchBrowser } from './support';

/** B-40 e2e: decorator unwrapping (03 §6.2) and the stability check (03 §5.5 step 8) on plain pages. */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  await page.goto('about:blank');
});

/** The ids of the roots {@link findRoots} finds under `#storybook-root`, and what it reports. */
async function roots(html: string, unwrap: boolean | number = true) {
  await page.setContent(`<body style="margin:0"><div id="storybook-root">${html}</div></body>`);
  const found = await findRoots(page, { storyId: 'test-wrapper--story', unwrap });
  if (found === undefined) throw new Error('no root container');
  const ids = await Promise.all(found.rootHandles.map((handle) => handle.evaluate((el) => el.id)));
  return { ids, warnings: found.warnings };
}

describe('resolveRoots (03 §6.2)', () => {
  it('descends through wrappers with the same box and no paint', async () => {
    expect(await roots('<div id="a"><div id="b"><section id="c">Hi</section></div></div>')).toEqual({
      ids: ['c'],
      warnings: [],
    });
    // A full-width block around an inline-block button is not the button's box: it stays.
    expect((await roots('<div id="a"><button id="c">Hi</button></div>')).ids).toEqual(['a']);
  });

  it('stops at a wrapper that paints, clips, pads, or has text of its own', async () => {
    expect((await roots('<div id="a" style="background:red"><span id="b">x</span></div>')).ids).toEqual(['a']);
    expect(
      (await roots('<div id="a" style="overflow:hidden"><span id="b" style="display:block">x</span></div>')).ids,
    ).toEqual(['a']);
    expect((await roots('<div id="a" style="padding:8px"><div id="b">x</div></div>')).ids).toEqual(['a']);
    expect((await roots('<div id="a">label <span id="b">x</span></div>')).ids).toEqual(['a']);
  });

  it('keeps fragments as several roots, and sees through display: contents', async () => {
    expect((await roots('<span id="a">1</span><span id="b">2</span>')).ids).toEqual(['a', 'b']);
    expect((await roots('<div id="w" style="display:contents"><i id="a">1</i><i id="b">2</i></div>')).ids).toEqual([
      'a',
      'b',
    ]);
  });

  it('sees through a known provider wrapper even with padding, and reports its background', async () => {
    const found = await roots(
      '<div id="t" data-theme="dark" style="padding:12px;background:rgb(0, 0, 0)"><p id="p">x</p></div>',
    );
    expect(found.ids).toEqual(['p']);
    expect(found.warnings).toEqual([
      expect.objectContaining({
        code: 'SB_DECORATOR_PAINTS',
        severity: 'info',
        sid: 'test-wrapper',
        value: 'rgb(0, 0, 0)',
        data: { storyId: 'test-wrapper--story', path: ':nth-child(1)', background: 'rgb(0, 0, 0)' },
      }),
    ]);
  });

  it('honours the depth limit and `unwrap: false`', async () => {
    const html = '<div id="a"><div id="b"><button id="c">Hi</button></div></div>';
    expect((await roots(html, false)).ids).toEqual(['a']);
    expect((await roots(html, 1)).ids).toEqual(['b']);
  });

  it('skips scripts, styles and hidden children', async () => {
    expect(
      (await roots('<style></style><script></script><div id="h" style="display:none"></div><b id="v">v</b>')).ids,
    ).toEqual(['v']);
  });
});

describe('checkStability (03 §5.5 step 8, S-07 Q17)', () => {
  const stability = () =>
    page.evaluate(checkStability, { selectors: ['#storybook-root'], ...STABILITY, intervalMs: 50 });

  it('passes a still root', async () => {
    await page.setContent('<div id="storybook-root"><p>still</p></div>');
    expect(await stability()).toEqual({ stable: true, tries: 1 });
  });

  it('catches a child that moves while the markup length stays the same', async () => {
    await page.setContent(`<div id="storybook-root" style="display:block"><div id="t" style="width:100px">x</div></div>
      <script>let w = 100; (function tick() { w = 100 + ((w + 1) % 50); document.getElementById('t').style.width = w + 'px'; requestAnimationFrame(tick); })();</script>`);
    expect(await stability()).toEqual({ stable: false, tries: 3 });
  });

  it('passes once a root settles within its tries', async () => {
    await page.setContent(`<div id="storybook-root"><div id="t" style="width:10px">x</div></div>
      <script>setTimeout(() => { document.getElementById('t').style.width = '20px'; }, 20);</script>`);
    expect((await stability()).stable).toBe(true);
  });
});
