import type { FigmaPort } from '@holotype/plugin/port';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createFakeFigma, type FakeFigma } from '../src';

/** Every member of the B-06 port (BUILD §8.1 row "Global"). Kept in sync with port.ts by the type test below. */
const PORT_MEMBERS = [
  'createFrame',
  'createComponent',
  'createText',
  'createRectangle',
  'createEllipse',
  'createVector',
  'createNodeFromSvg',
  'createPage',
  'createSection',
  'combineAsVariants',
  'createImage',
  'getImageByHash',
  'getNodeByIdAsync',
  'root',
  'currentPage',
  'setCurrentPageAsync',
  'skipInvisibleInstanceChildren',
  'fileKey',
  'loadFontAsync',
  'listAvailableFontsAsync',
  'commitUndo',
  'notify',
  'mixed',
  'clientStorage',
] as const satisfies readonly (keyof FigmaPort)[];

describe('FigmaPort', () => {
  it('is satisfied by createFakeFigma() and by the real figma object, with no casts', () => {
    // Compile-time proofs: `tsc` fails if either stops satisfying the port.
    expectTypeOf(createFakeFigma()).toExtend<FigmaPort>();
    expectTypeOf<PluginAPI>().toExtend<FigmaPort>();
    expectTypeOf<keyof FigmaPort>().toEqualTypeOf<(typeof PORT_MEMBERS)[number]>();
    const port: FigmaPort = createFakeFigma();
    expect(port).toBeDefined();
  });

  it('exposes every port member at runtime', () => {
    const fake: FakeFigma = createFakeFigma();
    for (const member of PORT_MEMBERS) expect(member in fake, member).toBe(true);
    expect(typeof fake.clientStorage.getAsync).toBe('function');
    expect(typeof fake.clientStorage.setAsync).toBe('function');
  });

  it('exposes figma.mixed as a constant symbol', () => {
    const fake = createFakeFigma();
    expect(typeof fake.mixed).toBe('symbol');
    expect(fake.mixed).toBe(createFakeFigma().mixed);
  });

  it('reads fileKey as configured (typings:74-79)', () => {
    expect(createFakeFigma({ fileKey: 'abc123' }).fileKey).toBe('abc123');
    expect(createFakeFigma({ fileKey: undefined }).fileKey).toBeUndefined();
    expect(typeof createFakeFigma().fileKey).toBe('string');
  });

  it('keeps clientStorage values as copies across reset()', async () => {
    const fake = createFakeFigma();
    const value = { port: 47321, token: 'x' };
    await fake.clientStorage.setAsync('pairing', value);
    value.port = 1;
    fake.reset();
    expect(await fake.clientStorage.getAsync('pairing')).toEqual({ port: 47321, token: 'x' });
    expect(await fake.clientStorage.getAsync('missing')).toBeUndefined();
    await expect(fake.clientStorage.setAsync('fn', () => 1)).rejects.toThrow();
  });

  it('records notifications and accepts commitUndo without writing', () => {
    const fake = createFakeFigma();
    const handle = fake.notify('Imported 3 components');
    handle.cancel();
    fake.commitUndo();
    expect(fake.notifications()).toEqual(['Imported 3 components']);
    expect(fake.ops()).toEqual([]);
    expect(() => fake.notify(42 as unknown as string)).toThrow(Error);
  });

  it('lists the configured fonts', async () => {
    const fake = createFakeFigma({ fonts: [{ family: 'Acme', style: 'Regular' }] });
    expect(await fake.listAvailableFontsAsync()).toEqual([{ fontName: { family: 'Acme', style: 'Regular' } }]);
  });
});
