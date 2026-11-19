import { createFakeFigma, type FakeFigma, type FakeFigmaOptions } from '../src';

export const INTER: FontName = { family: 'Inter', style: 'Regular' };
export const INTER_BOLD: FontName = { family: 'Inter', style: 'Bold' };

/** A fake with Inter Regular and Bold loaded. */
export async function fakeWithFonts(options: FakeFigmaOptions = {}): Promise<FakeFigma> {
  const figma = createFakeFigma(options);
  await figma.loadFontAsync(INTER);
  await figma.loadFontAsync(INTER_BOLD);
  return figma;
}

/** A text node with `characters`, fonts loaded. */
export async function textNode(characters: string): Promise<{ figma: FakeFigma; text: TextNode }> {
  const figma = await fakeWithFonts();
  const text = figma.createText();
  text.characters = characters;
  return { figma, text };
}

/** A horizontal auto-layout frame with one child frame appended. */
export function stack(figma: FakeFigma, mode: 'HORIZONTAL' | 'VERTICAL' = 'HORIZONTAL') {
  const parent = figma.createFrame();
  parent.layoutMode = mode;
  const child = figma.createFrame();
  parent.appendChild(child);
  return { parent, child };
}

export const RED: SolidPaint = { type: 'SOLID', color: { r: 1, g: 0, b: 0 } };
