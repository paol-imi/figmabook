import type { SceneText } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { applyToFake } from '../support/apply';
import { component, INTER_SEMIBOLD, node, range, solid, text } from '../support/scenes';

async function writeText(content: SceneText, box = { x: 4, y: 6, w: 120, h: 40 }) {
  const scene = component('text', 'Text', [
    {
      root: node(
        'root',
        'component',
        'Text',
        { x: 0, y: 0, w: 200, h: 100 },
        {
          fills: [],
          children: [node('root/text', 'text', 'Copy', box, { text: content })],
        },
      ),
    },
  ]);
  const { figma, result } = await applyToFake({ scenes: [scene] });
  const found = figma.root.children[1]?.findOne((n) => n.name === 'Copy');
  if (found?.type !== 'TEXT') throw new Error('text not written');
  return { node: found, result };
}

describe('text writer (09 §6.1)', () => {
  it('writes characters, then every range style', async () => {
    const { node: t } = await writeText(
      text('Save 20% today', [
        range(0, 5, { font: INTER_SEMIBOLD, fontSize: 16, letterSpacing: { unit: 'PIXELS', value: 0.5 } }),
        range(5, 8, {
          fills: [solid(1, 0, 0)],
          decoration: 'UNDERLINE',
          decorationStyle: 'WAVY',
          decorationColor: solid(0, 0, 1),
          decorationThickness: 2,
          decorationOffset: 1,
          textCase: 'UPPER',
        }),
        range(8, 14, { hyperlink: 'https://example.com/' }),
      ]),
    );
    expect(t.characters).toBe('Save 20% today');
    const segments = t.getStyledTextSegments([
      'fontName',
      'fontSize',
      'letterSpacing',
      'textCase',
      'textDecoration',
      'hyperlink',
      'fills',
    ]);
    expect(
      segments.map(({ start, end, fontName, fontSize, textCase, textDecoration, hyperlink }) => ({
        start,
        end,
        fontName,
        fontSize,
        textCase,
        textDecoration,
        hyperlink,
      })),
    ).toEqual([
      {
        start: 0,
        end: 5,
        fontName: { family: 'Inter', style: 'Semi Bold' },
        fontSize: 16,
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        hyperlink: null,
      },
      {
        start: 5,
        end: 8,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 14,
        textCase: 'UPPER',
        textDecoration: 'UNDERLINE',
        hyperlink: null,
      },
      {
        start: 8,
        end: 14,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 14,
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        hyperlink: { type: 'URL', value: 'https://example.com/' },
      },
    ]);
    expect(t.getRangeTextDecorationStyle(5, 8)).toBe('WAVY');
    expect(t.getRangeTextDecorationThickness(5, 8)).toEqual({ unit: 'PIXELS', value: 2 });
    expect(t.getRangeLineHeight(0, 14)).toEqual({ unit: 'PIXELS', value: 20 });
    expect([t.x, t.y]).toEqual([4, 6]);
  });

  it('keeps a fixed box for NONE and HEIGHT, sizing last', async () => {
    const fixed = await writeText(text('Fixed', [range(0, 5)], { autoResize: 'NONE' }));
    expect([fixed.node.textAutoResize, fixed.node.width, fixed.node.height]).toEqual(['NONE', 120, 40]);
    const height = await writeText(
      text('Grows', [range(0, 5)], { autoResize: 'HEIGHT', alignH: 'RIGHT', alignV: 'BOTTOM' }),
    );
    expect([height.node.textAutoResize, height.node.width]).toEqual(['HEIGHT', 120]);
    expect([height.node.textAlignHorizontal, height.node.textAlignVertical]).toEqual(['RIGHT', 'BOTTOM']);
  });

  it('lets Figma size WIDTH_AND_HEIGHT text', async () => {
    const { node: t } = await writeText(text('Hug', [range(0, 3)], { autoResize: 'WIDTH_AND_HEIGHT' }));
    expect(t.textAutoResize).toBe('WIDTH_AND_HEIGHT');
  });

  it('truncates with maxLines, and never writes the deprecated TRUNCATE', async () => {
    const lines = await writeText(
      text('A long description', [range(0, 18)], { autoResize: 'HEIGHT', truncation: { maxLines: 2 } }),
    );
    expect([lines.node.textAutoResize, lines.node.textTruncation, lines.node.maxLines]).toEqual(['NONE', 'ENDING', 2]);
    const legacy = await writeText(text('Legacy', [range(0, 6)], { autoResize: 'TRUNCATE' }));
    expect([legacy.node.textAutoResize, legacy.node.textTruncation]).toEqual(['NONE', 'ENDING']);
  });

  it('writes paragraph settings when present', async () => {
    const { node: t } = await writeText(
      text('One\nTwo', [range(0, 7)], {
        paragraphSpacing: 8,
        paragraphIndent: 4,
        leadingTrim: 'CAP_HEIGHT',
        wrapStyle: 'BALANCE',
      }),
    );
    expect([t.paragraphSpacing, t.paragraphIndent, t.leadingTrim, t.textWrapStyle]).toEqual([
      8,
      4,
      'CAP_HEIGHT',
      'BALANCE',
    ]);
  });

  it('styles an empty text from its first range', async () => {
    const { node: t, result } = await writeText(text('', [range(0, 0, { fontSize: 18, font: INTER_SEMIBOLD })]));
    expect(result.summary.componentsOk).toBe(1);
    expect([t.characters, t.fontSize, t.fontName]).toEqual(['', 18, { family: 'Inter', style: 'Semi Bold' }]);
  });

  it('clamps ranges to the characters and skips empty ones', async () => {
    const { node: t, result } = await writeText(
      text('Hi', [range(0, 1, { fontSize: 20 }), range(1, 9, { fontSize: 10 }), range(9, 9)]),
    );
    expect(result.summary.componentsOk).toBe(1);
    expect(t.getStyledTextSegments(['fontSize']).map(({ start, end, fontSize }) => [start, end, fontSize])).toEqual([
      [0, 1, 20],
      [1, 2, 10],
    ]);
  });
});
