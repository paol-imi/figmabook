import { describe, expect, it } from 'vitest';
import { createFakeFigma } from '../src';
import { fakeWithFonts, INTER_BOLD, RED, textNode } from './helpers';

describe('loadFontAsync gating (typings:1662-1698, working-with-text)', () => {
  it('every layout-affecting text write throws until the font is loaded', () => {
    const figma = createFakeFigma();
    const text = figma.createText();
    const writes: Array<[string, () => void]> = [
      [
        'characters',
        () => {
          text.characters = 'x';
        },
      ],
      [
        'fontSize',
        () => {
          text.fontSize = 14;
        },
      ],
      [
        'textCase',
        () => {
          text.textCase = 'UPPER';
        },
      ],
      [
        'textDecoration',
        () => {
          text.textDecoration = 'UNDERLINE';
        },
      ],
      [
        'letterSpacing',
        () => {
          text.letterSpacing = { value: 1, unit: 'PIXELS' };
        },
      ],
      [
        'lineHeight',
        () => {
          text.lineHeight = { value: 20, unit: 'PIXELS' };
        },
      ],
      [
        'leadingTrim',
        () => {
          text.leadingTrim = 'CAP_HEIGHT';
        },
      ],
      [
        'paragraphSpacing',
        () => {
          text.paragraphSpacing = 4;
        },
      ],
      [
        'paragraphIndent',
        () => {
          text.paragraphIndent = 4;
        },
      ],
      [
        'textAlignHorizontal',
        () => {
          text.textAlignHorizontal = 'CENTER';
        },
      ],
      [
        'textAlignVertical',
        () => {
          text.textAlignVertical = 'CENTER';
        },
      ],
      [
        'textAutoResize',
        () => {
          text.textAutoResize = 'HEIGHT';
        },
      ],
      ['insertCharacters', () => text.insertCharacters(0, 'x')],
    ];
    for (const [name, write] of writes) expect(write, name).toThrow(/unloaded font "Inter Regular"/);
    expect(figma.ops().filter((op) => op.nodeId === text.id && op.method !== 'createText')).toEqual([]);
  });

  it('fills, name and hyperlinks do not need a loaded font', () => {
    const text = createFakeFigma().createText();
    text.fills = [RED];
    text.name = 'Label';
    expect(text.name).toBe('Label');
  });

  it('setting fontName needs only the new font (working-with-text)', async () => {
    const figma = createFakeFigma();
    await figma.loadFontAsync(INTER_BOLD);
    const text = figma.createText();
    text.fontName = INTER_BOLD;
    text.characters = 'Bold';
    expect(text.fontName).toEqual(INTER_BOLD);
    expect(text.fontWeight).toBe(700);
  });

  it('loadFontAsync without style loads the whole family; unknown fonts reject', async () => {
    const figma = createFakeFigma();
    await figma.loadFontAsync({ family: 'Inter' });
    const text = figma.createText();
    text.fontName = { family: 'Inter', style: 'Semi Bold' };
    expect(text.fontWeight).toBe(600);
    await expect(figma.loadFontAsync({ family: 'Nope', style: 'Regular' })).rejects.toThrow(/could not be loaded/);
  });

  it('reset() forgets loaded fonts, like a new plugin run', async () => {
    const { figma, text } = await textNode('a');
    figma.reset();
    expect(() => {
      text.characters = 'b';
    }).toThrow(/unloaded font/);
  });

  it('hasMissingFont is true for a font the editor does not have', async () => {
    const figma = createFakeFigma({ fonts: [{ family: 'Roboto', style: 'Regular' }] });
    const text = figma.createText();
    expect(text.hasMissingFont).toBe(true);
    await expect(figma.loadFontAsync({ family: 'Inter', style: 'Regular' })).rejects.toThrow();
    await figma.loadFontAsync({ family: 'Roboto', style: 'Regular' });
    text.fontName = { family: 'Roboto', style: 'Regular' };
    expect(text.hasMissingFont).toBe(false);
  });
});

describe('characters and ranges (typings:9767-10172)', () => {
  it('characters renames the node while autoRename is on; renaming turns it off (typings:11052-11058)', async () => {
    const { text } = await textNode('Submit');
    expect(text.name).toBe('Submit');
    text.name = 'CTA';
    expect(text.autoRename).toBe(false);
    text.characters = 'Send';
    expect(text.name).toBe('CTA');
  });

  it('range setters style [start, end) and node getters return figma.mixed', async () => {
    const { figma, text } = await textNode('Hello world');
    text.setRangeFontName(6, 11, INTER_BOLD);
    text.setRangeFontSize(6, 11, 20);
    text.setRangeFills(0, 5, [RED]);
    text.setRangeLineHeight(0, 11, { value: 24, unit: 'PIXELS' });
    text.setRangeLetterSpacing(0, 5, { value: 2, unit: 'PERCENT' });
    text.setRangeTextCase(0, 1, 'UPPER');
    text.setRangeTextDecoration(0, 5, 'UNDERLINE');
    text.setRangeHyperlink(0, 5, { type: 'URL', value: 'https://example.com' });
    expect(text.fontName).toBe(figma.mixed);
    expect(text.fontSize).toBe(figma.mixed);
    expect(text.fills).toBe(figma.mixed);
    expect(text.lineHeight).toEqual({ value: 24, unit: 'PIXELS' });
    expect(text.getRangeFontName(6, 11)).toEqual(INTER_BOLD);
    expect(text.getRangeFontSize(0, 5)).toBe(12);
    expect(text.getRangeFontWeight(6, 11)).toBe(700);
    expect(text.getRangeAllFontNames(0, 11)).toEqual([{ family: 'Inter', style: 'Regular' }, INTER_BOLD]);
    expect(text.getRangeTextCase(0, 2)).toBe(figma.mixed);
    expect(text.getRangeHyperlink(0, 5)).toEqual({ type: 'URL', value: 'https://example.com' });
    expect(text.getRangeTextDecorationStyle(0, 5)).toBe('SOLID');
    expect(text.getRangeTextDecorationStyle(6, 11)).toBeNull();
  });

  it('range indexes must be inside the text with start < end', async () => {
    const { text } = await textNode('abc');
    expect(() => text.setRangeFontSize(0, 4, 10)).toThrow(/outside/);
    expect(() => text.setRangeFontSize(2, 2, 10)).toThrow(/outside/);
    expect(() => text.getRangeFontSize(-1, 1)).toThrow(/outside/);
  });

  it('range setters need the fonts of the range loaded', async () => {
    const { figma, text } = await textNode('ab');
    figma.reset();
    expect(() => text.setRangeFontSize(0, 1, 30)).toThrow(/unloaded font/);
    expect(() => text.setRangeFills(0, 1, [RED])).toThrow(/unloaded font/);
    text.setRangeHyperlink(0, 1, null);
  });

  it('fontSize has a minimum of 1 (typings:9772-9775)', async () => {
    const { text } = await textNode('a');
    expect(() => {
      text.fontSize = 0.5;
    }).toThrow(/>= 1/);
    expect(() => text.setRangeFontSize(0, 1, 0)).toThrow(/>= 1/);
  });

  it('insertCharacters copies the neighbouring style; deleteCharacters removes styles with characters', async () => {
    const { text } = await textNode('ab');
    text.setRangeFontSize(0, 1, 30);
    text.insertCharacters(1, 'X');
    expect(text.characters).toBe('aXb');
    expect(text.getRangeFontSize(1, 2)).toBe(30);
    text.insertCharacters(1, 'Y', 'AFTER');
    expect(text.getRangeFontSize(1, 2)).toBe(30);
    text.insertCharacters(3, 'Z', 'AFTER');
    expect(text.getRangeFontSize(3, 4)).toBe(12);
    text.deleteCharacters(0, 3);
    expect(text.characters).toBe('Zb');
    expect(text.fontSize).toBe(12);
  });

  it('getStyledTextSegments splits on the requested fields only and returns only them (typings:10025-10170)', async () => {
    const { text } = await textNode('aaBBcc');
    text.setRangeFontSize(2, 4, 18);
    text.setRangeFills(4, 6, [RED]);
    const bySize = text.getStyledTextSegments(['fontSize']);
    expect(bySize).toEqual([
      { characters: 'aa', start: 0, end: 2, fontSize: 12 },
      { characters: 'BB', start: 2, end: 4, fontSize: 18 },
      { characters: 'cc', start: 4, end: 6, fontSize: 12 },
    ]);
    const both = text.getStyledTextSegments(['fontSize', 'fills', 'fontWeight']);
    expect(both.map((s) => s.characters)).toEqual(['aa', 'BB', 'cc']);
    expect(Object.keys(both[0] ?? {}).sort()).toEqual([
      'characters',
      'end',
      'fills',
      'fontSize',
      'fontWeight',
      'start',
    ]);
    expect(text.getStyledTextSegments(['fontSize'], 1, 3).map((s) => s.characters)).toEqual(['a', 'B']);
    const empty = createFakeFigma().createText();
    expect(empty.getStyledTextSegments(['fontSize'])).toEqual([]);
  });

  it('an empty node keeps a base style that new characters take', async () => {
    const figma = await fakeWithFonts();
    const text = figma.createText();
    text.fontSize = 22;
    text.fontName = INTER_BOLD;
    text.characters = 'New';
    expect([text.fontSize, text.fontName]).toEqual([22, INTER_BOLD]);
  });

  it('textDecoration details are null on undecorated text', async () => {
    const { text } = await textNode('a');
    expect(text.textDecorationStyle).toBeNull();
    text.textDecoration = 'UNDERLINE';
    text.textDecorationStyle = 'WAVY';
    text.textDecorationThickness = { value: 2, unit: 'PIXELS' };
    expect([text.textDecorationStyle, text.textDecorationThickness]).toEqual(['WAVY', { value: 2, unit: 'PIXELS' }]);
  });
});

describe('text node properties (typings:11010-11069)', () => {
  it('maxLines is >= 1 or null; truncation and alignment are enums', async () => {
    const { text } = await textNode('a');
    text.textTruncation = 'ENDING';
    text.maxLines = 2;
    text.textAlignHorizontal = 'RIGHT';
    text.textAlignVertical = 'BOTTOM';
    expect([text.textTruncation, text.maxLines, text.textAlignHorizontal, text.textAlignVertical]).toEqual([
      'ENDING',
      2,
      'RIGHT',
      'BOTTOM',
    ]);
    expect(() => {
      text.maxLines = 0;
    }).toThrow(/>= 1/);
    text.maxLines = null;
    expect(text.maxLines).toBeNull();
    expect(() => {
      text.textAlignHorizontal = 'START' as 'LEFT';
    }).toThrow(/expected one of/);
  });

  it('textStyleId is read-only under dynamic-page; the deprecated range style setters throw', async () => {
    const { text } = await textNode('a');
    expect(text.textStyleId).toBe('');
    expect(() => {
      text.textStyleId = 'S:1';
    }).toThrow(/setTextStyleIdAsync/);
    expect(() => text.setRangeTextStyleId(0, 1, 'S:1')).toThrow(/dynamic-page/);
    expect(() => text.setRangeFillStyleId(0, 1, 'S:1')).toThrow(/dynamic-page/);
  });

  it('layoutSizing on text maps to textAutoResize (typings:7415-7500)', async () => {
    const { figma, text } = await textNode('a');
    const parent = figma.createFrame();
    parent.layoutMode = 'VERTICAL';
    parent.appendChild(text);
    text.layoutSizingHorizontal = 'FILL';
    expect([text.textAutoResize, text.layoutSizingVertical]).toEqual(['HEIGHT', 'HUG']);
    text.layoutSizingVertical = 'FIXED';
    expect(text.textAutoResize).toBe('NONE');
    text.layoutSizingVertical = 'HUG';
    expect(text.textAutoResize).toBe('HEIGHT');
  });
});
