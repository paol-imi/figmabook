import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageRoot } from '../support/storybook.ts';

const tokensCss = readFileSync(join(packageRoot, 'src/tokens/tokens.css'), 'utf8');

/** Custom properties declared inside the first rule whose selector equals `selector`. */
function declaredIn(selector: string): Map<string, string> {
  const start = tokensCss.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`tokens.css has no "${selector}" rule.`);
  const body = tokensCss.slice(start, tokensCss.indexOf('\n}', start));
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '');
  return new Map([...withoutComments.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? '', m[2] ?? '']));
}

const root = declaredIn(':root');
const dark = declaredIn('[data-theme="dark"]');

function listFiles(dir: string, suffix: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

const componentModules = listFiles(join(packageRoot, 'src/components'), '.module.css');

describe('tokens.css', () => {
  it('declares the primitive scales of B-03', () => {
    for (let step = 1; step <= 8; step++) expect(root.has(`--space-${step}`)).toBe(true);
    for (const radius of ['sm', 'md', 'lg', 'full']) expect(root.has(`--radius-${radius}`)).toBe(true);
    for (const shadow of ['sm', 'md']) expect(root.has(`--shadow-${shadow}`)).toBe(true);
    for (const hue of ['gray', 'blue', 'green', 'amber', 'red']) expect(root.has(`--color-${hue}-500`)).toBe(true);
    expect([...root.keys()].filter((name) => name.startsWith('--font-size-')).length).toBeGreaterThan(0);
    expect([...root.keys()].filter((name) => name.startsWith('--line-height-')).length).toBeGreaterThan(0);
  });

  it('declares the semantic aliases as var() references', () => {
    for (const name of ['--color-bg', '--color-fg', '--color-primary']) expect(root.get(name)).toMatch(/^var\(--/);
    expect(root.get('--button-bg')).toBe('var(--color-primary)');
  });

  it('has one calc() token and one color-mix() token (unbindable cases, 12 §2.2)', () => {
    const values = [...root.values()];
    expect(values.filter((value) => value.startsWith('calc(')).length).toBe(1);
    expect(values.filter((value) => value.startsWith('color-mix(')).length).toBe(1);
  });

  it('overrides only declared tokens in the dark theme', () => {
    expect(dark.size).toBeGreaterThan(0);
    for (const name of dark.keys()) expect(root.has(name), name).toBe(true);
  });

  it('references only declared tokens', () => {
    for (const value of [...root.values(), ...dark.values()]) {
      for (const [, name] of value.matchAll(/var\((--[\w-]+)\)/g)) expect(root.has(name ?? ''), name).toBe(true);
    }
  });
});

describe('component CSS modules', () => {
  it('exist for every component', () => {
    expect(componentModules.map((file) => relative(packageRoot, file))).toEqual([
      'src/components/Badge/Badge.module.css',
      'src/components/Button/Button.module.css',
      'src/components/Card/Card.module.css',
      'src/components/Icon/Icon.module.css',
      'src/components/Icon/IconGallery.module.css',
      'src/components/Input/Input.module.css',
      'src/components/Stack/Stack.module.css',
    ]);
  });

  it.each(componentModules.map((file) => [relative(packageRoot, file), file]))(
    '%s uses only token values',
    (_name, file) => {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      // Raw design values belong in tokens.css: no hex colors, color functions or non-zero lengths.
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|oklab)\(/);
      expect(css).not.toMatch(/(?<![\w-])[1-9]\d*(\.\d+)?(px|rem|em)\b/);
      for (const [, name] of css.matchAll(/var\((--[\w-]+)\)/g)) expect(root.has(name ?? ''), name).toBe(true);
    },
  );
});
