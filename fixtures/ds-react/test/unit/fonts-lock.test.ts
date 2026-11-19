import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeFontsLock,
  fontsCssPath,
  fontsLockPath,
  parseFontFaces,
  parseImports,
  serializeFontsLock,
} from '../../scripts/fonts-lock.ts';

describe('fixtures/fonts.lock', () => {
  it('is up to date with src/styles/fonts.css and the installed font files', () => {
    // On failure: run `pnpm -F @holotype/fixture-ds-react fonts:lock` and review the diff.
    expect(readFileSync(fontsLockPath, 'utf8')).toBe(serializeFontsLock(computeFontsLock()));
  });

  it('pins Inter 400/500/600/700, upright, woff2 first', () => {
    const lock = computeFontsLock();
    expect(lock.faces.map((face) => `${face.family} ${face.weight} ${face.style}`)).toEqual([
      'Inter 400 normal',
      'Inter 500 normal',
      'Inter 600 normal',
      'Inter 700 normal',
    ]);
    for (const face of lock.faces) {
      expect(face.files.map((file) => file.format)).toEqual(['woff2', 'woff']);
      for (const file of face.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('fails loudly when fonts.css imports nothing', () => {
    expect(() => computeFontsLock('/* no imports */')).toThrow(/imports no font stylesheets/);
  });
});

describe('parseImports', () => {
  it('returns bare specifiers in order', () => {
    expect(parseImports(`@import "a/b.css";\n@import 'c/d.css' ;`)).toEqual(['a/b.css', 'c/d.css']);
  });

  it('reads the committed fonts.css', () => {
    expect(parseImports(readFileSync(fontsCssPath, 'utf8'))).toHaveLength(4);
  });
});

describe('parseFontFaces', () => {
  it('reads family, weight, style and every source', () => {
    const css = `@font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 600;
      src: url(./files/a.woff2) format('woff2'), url("./files/a.woff") format("woff");
    }`;
    expect(parseFontFaces(css)).toEqual([
      {
        family: 'Inter',
        weight: 600,
        style: 'normal',
        sources: [
          { url: './files/a.woff2', format: 'woff2' },
          { url: './files/a.woff', format: 'woff' },
        ],
      },
    ]);
  });

  it('rejects a face without a required descriptor', () => {
    expect(() => parseFontFaces('@font-face { font-family: X; font-weight: 400; src: url(a) format(woff2); }')).toThrow(
      /without "font-style"/,
    );
  });
});
