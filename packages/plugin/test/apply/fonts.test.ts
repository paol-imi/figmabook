import { describe, expect, it, vi } from 'vitest';
import { FontResolver, fontRequestKey, nearestStyle, rankStyles, styleWeight } from '../../src/apply/fonts';
import { createFakeFigma } from '../support/fake';
import { font, INTER_SEMIBOLD } from '../support/scenes';

const where = { sid: 'components-x', nodeKey: 'root/label' };

function resolver(fonts?: readonly FontName[]) {
  const figma = createFakeFigma(fonts ? { fonts } : {});
  const emitted: { code: string; value?: string; fallback?: string; severity: string }[] = [];
  const load = vi.spyOn(figma, 'loadFontAsync');
  const list = vi.spyOn(figma, 'listAvailableFontsAsync');
  return { figma, load, list, emitted, fonts: new FontResolver(figma, (d) => emitted.push(d)) };
}

describe('styleWeight / nearestStyle', () => {
  it.each([
    ['Thin', 100],
    ['ExtraLight', 200],
    ['Light', 300],
    ['Regular', 400],
    ['Book', 400],
    ['Medium', 500],
    ['Semi Bold', 600],
    ['DemiBold Italic', 600],
    ['Bold', 700],
    ['Extra Bold', 800],
    ['Black', 900],
  ])('%s weighs %i', (style, weight) => {
    expect(styleWeight(style)).toBe(weight);
  });

  it('picks the closest weight of the same slant, heavier on a tie', () => {
    const styles = ['Regular', 'Italic', 'Medium', 'Bold', 'Bold Italic'];
    expect(nearestStyle(styles, 600, false)).toBe('Bold');
    expect(nearestStyle(styles, 450, false)).toBe('Medium');
    expect(nearestStyle(styles, 700, true)).toBe('Bold Italic');
    expect(nearestStyle(['Regular'], 700, true)).toBe('Regular');
    expect(nearestStyle([], 400, false)).toBeUndefined();
    expect(rankStyles(styles, 600, false)).toEqual(['Bold', 'Medium', 'Regular', 'Bold Italic', 'Italic']);
  });

  it('keys requests by the fields that decide their resolution', () => {
    expect(fontRequestKey(INTER_SEMIBOLD)).toBe(fontRequestKey({ ...INTER_SEMIBOLD, isCustom: true }));
    expect(fontRequestKey(INTER_SEMIBOLD)).not.toBe(fontRequestKey({ ...INTER_SEMIBOLD, weight: 700 }));
  });
});

describe('FontResolver (09 §5.1, slice)', () => {
  it('uses the first available style candidate, with no diagnostic', async () => {
    const { fonts, emitted } = resolver();
    expect(await fonts.resolve(font('Inter', 600, ['SemiBold', 'Semi Bold']), where)).toEqual({
      family: 'Inter',
      style: 'Semi Bold',
    });
    expect(emitted).toEqual([]);
  });

  it('falls back to Inter at the nearest weight with FONT_MISSING, once per request', async () => {
    const { fonts, emitted } = resolver();
    const acme = font('Acme Sans', 650, ['SemiBold']);
    expect(await fonts.resolve(acme, where)).toEqual({ family: 'Inter', style: 'Bold' });
    expect(await fonts.resolve(acme, where)).toEqual({ family: 'Inter', style: 'Bold' });
    expect(emitted).toEqual([
      expect.objectContaining({
        code: 'FONT_MISSING',
        severity: 'warn',
        value: 'Acme Sans SemiBold',
        fallback: 'Inter Bold',
      }),
    ]);
  });

  it("prefers the request's own fallback family over Inter", async () => {
    const { fonts } = resolver([
      { family: 'Roboto', style: 'Medium' },
      { family: 'Inter', style: 'Regular' },
    ]);
    expect(await fonts.resolve({ ...font('Acme', 500, ['Medium']), fallbackFamily: 'Roboto' }, where)).toEqual({
      family: 'Roboto',
      style: 'Medium',
    });
  });

  it('uses any available family when neither the fallback nor Inter exists', async () => {
    const { fonts, emitted } = resolver([{ family: 'Roboto', style: 'Bold' }]);
    expect(await fonts.resolve(font('Acme', 700, ['Bold']), where)).toEqual({ family: 'Roboto', style: 'Bold' });
    expect(emitted).toMatchObject([{ code: 'FONT_MISSING', fallback: 'Roboto Bold' }]);
  });

  it('treats a font Figma refuses to load as missing', async () => {
    const { figma, fonts, emitted } = resolver();
    vi.spyOn(figma, 'loadFontAsync').mockImplementation(async (name) => {
      if (name.style === 'Semi Bold') throw new Error('in loadFontAsync: The font could not be loaded');
    });
    expect(await fonts.resolve(INTER_SEMIBOLD, where)).toEqual({ family: 'Inter', style: 'Bold' });
    expect(emitted).toMatchObject([{ code: 'FONT_MISSING', value: 'Inter Semi Bold' }]);
  });

  it('throws FONT_MISSING (error) when no font loads at all', async () => {
    const { fonts } = resolver([]);
    await expect(fonts.resolve(INTER_SEMIBOLD, where)).rejects.toMatchObject({
      code: 'FONT_MISSING',
      diagnostics: [expect.objectContaining({ severity: 'error', sid: 'components-x' })],
    });
  });

  it('lists fonts once and loads each FontName once per session', async () => {
    const { fonts, load, list } = resolver();
    await Promise.all([
      fonts.resolve(INTER_SEMIBOLD, where),
      fonts.resolve({ ...INTER_SEMIBOLD, isCustom: true }, where),
      fonts.resolve(font('Inter', 600, ['Semi Bold']), where),
    ]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(load.mock.calls).toEqual([[{ family: 'Inter', style: 'Semi Bold' }]]);
  });
});
