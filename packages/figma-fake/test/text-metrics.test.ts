import { describe, expect, it } from 'vitest';
import { createFakeFigma, type FakeFigma } from '../src';
import { INTER, INTER_BOLD, textNode } from './helpers';

const AUTO_INTER = 1.2109375;

describe('text metrics (BUILD §8.1 "Text metrics")', () => {
  it('an empty text is one auto line of Inter Regular 12', () => {
    const text = createFakeFigma().createText();
    expect([text.width, text.height]).toEqual([0, 12 * AUTO_INTER]);
  });

  it('auto-width text grows with its characters, deterministically', async () => {
    const { text } = await textNode('Hi');
    const short = text.width;
    text.characters = 'Hi there';
    expect(text.width).toBeGreaterThan(short);
    expect(text.height).toBe(12 * AUTO_INTER);
    const again = await textNode('Hi there');
    expect([again.text.width, again.text.height]).toEqual([text.width, text.height]);
  });

  it('size, weight, letter spacing and case change the advance', async () => {
    const { text } = await textNode('abc');
    const base = text.width;
    text.fontSize = 24;
    expect(text.width).toBeCloseTo(base * 2);
    expect(text.height).toBeCloseTo(24 * AUTO_INTER);
    text.fontSize = 12;
    text.fontName = INTER_BOLD;
    expect(text.width).toBeGreaterThan(base);
    text.fontName = INTER;
    text.letterSpacing = { value: 2, unit: 'PIXELS' };
    expect(text.width).toBeCloseTo(base + 6);
    text.letterSpacing = { value: 0, unit: 'PERCENT' };
    text.textCase = 'UPPER';
    expect(text.width).toBeGreaterThan(base);
  });

  it('line height: PIXELS, PERCENT and AUTO; the tallest run sets the line', async () => {
    const { text } = await textNode('ab');
    text.lineHeight = { value: 20, unit: 'PIXELS' };
    expect(text.height).toBe(20);
    text.lineHeight = { value: 150, unit: 'PERCENT' };
    expect(text.height).toBe(18);
    text.lineHeight = { unit: 'AUTO' };
    text.setRangeFontSize(1, 2, 30);
    expect(text.height).toBeCloseTo(30 * AUTO_INTER);
  });

  it('newlines start paragraphs, separated by paragraphSpacing; U+2028 breaks a line', async () => {
    const { text } = await textNode('one\ntwo');
    const line = 12 * AUTO_INTER;
    expect(text.height).toBeCloseTo(2 * line);
    text.paragraphSpacing = 6;
    expect(text.height).toBeCloseTo(2 * line + 6);
    text.characters = 'one two';
    expect(text.height).toBeCloseTo(2 * line);
  });

  it('fixed-width text wraps at spaces and between characters of long words', async () => {
    const { text } = await textNode('aaaa bbbb cccc');
    const line = 12 * AUTO_INTER;
    const oneWord = (await textNode('aaaa')).text.width;
    text.resize(oneWord + 1, 10);
    expect(text.textAutoResize).toBe('HEIGHT');
    expect(text.height).toBeCloseTo(3 * line);
    text.characters = 'aaaaaaaaaaaa';
    expect(text.height).toBeCloseTo(3 * line);
  });

  it('truncation caps the height at maxLines', async () => {
    const { text } = await textNode('a b c d');
    text.resize(1, 10);
    const line = 12 * AUTO_INTER;
    expect(text.height).toBeCloseTo(4 * line);
    text.textTruncation = 'ENDING';
    text.maxLines = 2;
    expect(text.height).toBeCloseTo(2 * line);
  });

  it('NONE keeps the size that was set; HEIGHT recomputes the height after a resize', async () => {
    const { text } = await textNode('short');
    // resize() fixes the width (09 §6.2): auto-width text becomes HEIGHT, whose height follows the content.
    text.resize(300, 77);
    expect([text.textAutoResize, text.height]).toEqual(['HEIGHT', 12 * AUTO_INTER]);
    text.textAutoResize = 'NONE';
    text.resize(300, 77);
    text.characters = 'a much longer text than before';
    expect([text.width, text.height]).toEqual([300, 77]);
  });
});

describe('oracle mode (BUILD §8.1: "takes the line count from the Scene IR lines")', () => {
  async function withOracle(lines: (node: TextNode) => number | undefined): Promise<FakeFigma> {
    const figma = createFakeFigma({ textOracle: lines });
    await figma.loadFontAsync(INTER);
    return figma;
  }

  it('sizes text as lines × line height, keyed by the node', async () => {
    const figma = await withOracle((node) => (node.getSharedPluginData('holotype', 'nk') === 'title' ? 3 : undefined));
    const title = figma.createText();
    title.setSharedPluginData('holotype', 'nk', 'title');
    title.characters = 'Short';
    title.lineHeight = { value: 20, unit: 'PIXELS' };
    expect(title.height).toBe(60);
    const other = figma.createText();
    other.characters = 'Short';
    other.lineHeight = { value: 20, unit: 'PIXELS' };
    expect(other.height).toBe(20);
  });

  it('lets the line-parity check of 09 §11.1 be tested in isolation: widening restores parity', async () => {
    // The browser broke the text into 2 lines; the oracle answers 3 until the text is 4 px wider.
    const figma = await withOracle((node) => (node.width >= 104 ? 2 : 3));
    const parent = figma.createFrame();
    parent.layoutMode = 'VERTICAL';
    const text = figma.createText();
    parent.appendChild(text);
    text.characters = 'Some label text';
    text.lineHeight = { value: 16, unit: 'PIXELS' };
    text.resize(100, 48);
    text.textAutoResize = 'HEIGHT';
    const count = () => Math.round(text.height / 16);
    expect(count()).toBe(3);
    let buffer = 0;
    for (let b = 0.5; b <= 8 && count() !== 2; b += 0.5) {
      text.minWidth = 100 + b;
      buffer = b;
    }
    expect([count(), buffer, text.width]).toEqual([2, 4, 104]);
  });

  it('can be switched on and off; text is re-measured on its next write', async () => {
    const figma = await withOracle(() => 5);
    const text = figma.createText();
    text.characters = 'x';
    expect(text.height).toBeCloseTo(5 * 12 * AUTO_INTER);
    figma.setTextOracle(null);
    text.characters = 'y';
    expect(text.height).toBeCloseTo(12 * AUTO_INTER);
  });
});
