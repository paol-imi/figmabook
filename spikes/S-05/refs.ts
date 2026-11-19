/**
 * S-05 reference renders, made in the container with headless Chromium (BUILD §9.1). For each
 * case: the child's rect inside the box, the measured dash pattern, and a 1x PNG of the canvas.
 * Runs in Node (Playwright); `pnpm -F @holotype/spikes refs` writes `S-05/refs.json`.
 */
import { chromium } from 'playwright';
import { dashPattern, rowRuns } from '../_shared/pixels.ts';
import { type BorderCase, CASES, caseHtml, MARGIN } from './cases.ts';

export const REFS_FORMAT = 'holotype-s05-refs/1';

export type CaseRef = {
  readonly child: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** CSS dash and gap lengths along the top border, for dashed cases. */
  readonly dash: { readonly dash: number; readonly gap: number; readonly startsWithInk: boolean } | null;
  /** PNG of the whole canvas at 1x, base64. */
  readonly png: string;
};

export type RefsFile = {
  readonly format: typeof REFS_FORMAT;
  readonly renderer: string;
  readonly cases: Readonly<Record<string, CaseRef>>;
};

const DECODE = `async (base64) => {
  const image = new Image();
  image.src = 'data:image/png;base64,' + base64;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, data: Array.from(context.getImageData(0, 0, image.width, image.height).data) };
}`;

async function renderCase(page: import('playwright').Page, testCase: BorderCase): Promise<CaseRef> {
  await page.setContent(`<!doctype html><html><body style="margin:0">${caseHtml(testCase)}</body></html>`);
  const child = await page.evaluate(() => {
    const box = document.getElementById('box')?.getBoundingClientRect();
    const rect = document.getElementById('child')?.getBoundingClientRect();
    if (!box || !rect) throw new Error('S-05 reference page is missing #box or #child');
    return { x: rect.x - box.x, y: rect.y - box.y, width: rect.width, height: rect.height };
  });
  const canvas = page.locator('#canvas');
  const png = (await canvas.screenshot({ animations: 'disabled', scale: 'css' })).toString('base64');
  let dash: CaseRef['dash'] = null;
  if (testCase.border?.style === 'dashed') {
    const image = (await page.evaluate(`(${DECODE})(${JSON.stringify(png)})`)) as { width: number; data: number[] };
    const [top] = testCase.border.widths;
    const y = MARGIN + Math.floor(top / 2);
    const row = rowRuns(
      { width: image.width, data: Uint8Array.from(image.data) },
      y,
      MARGIN,
      MARGIN + 120,
      (r, g, b) => r + g + b < 3 * 128,
    );
    const pattern = dashPattern(row);
    dash = pattern ? { ...pattern, startsWithInk: row.startsWithInk } : null;
  }
  return { child, dash, png };
}

export async function renderRefs(): Promise<RefsFile> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
    const cases: Record<string, CaseRef> = {};
    for (const testCase of CASES) cases[testCase.id] = await renderCase(page, testCase);
    return { format: REFS_FORMAT, renderer: `chromium/${browser.version()}`, cases };
  } finally {
    await browser.close();
  }
}
