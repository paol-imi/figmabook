import { readdirSync, readFileSync } from 'node:fs';
import type { ScenePropertyDef } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPPER_SETTINGS, mapComponent, STAGES, type Stage, settingsProblem } from '../src';
import { placeVariants } from '../src/set-grid';
import { orderStages, runStages } from '../src/stages/run';
import type { ComponentState } from '../src/state';
import { loadCapture, settings, singleInput } from './support';

describe('stage registry (07 §1)', () => {
  it('lists the stages in 07 §1 order with unique step numbers', () => {
    const steps = STAGES.map((stage) => stage.step);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(new Set(steps).size).toBe(steps.length);
    expect(STAGES.map((stage) => `${stage.step} ${stage.name}`)).toEqual([
      '1 normalize',
      '6 text',
      '7 visuals',
      '11 properties',
      '13 naming',
      '14 emit',
      '15 hash',
      '16 validate',
    ]);
  });

  it('runs an appended stage in its step position', () => {
    const late: Stage = { step: 2, name: 'order', per: 'component', run: () => {} };
    expect(
      orderStages([...STAGES, late])
        .map((stage) => stage.step)
        .slice(0, 3),
    ).toEqual([1, 2, 6]);
  });

  it('refuses two stages with the same step', () => {
    const twin: Stage = { step: 6, name: 'text-again', per: 'component', run: () => {} };
    expect(() => orderStages([...STAGES, twin])).toThrow(/share step 6/);
  });

  it('runs variant stages once per variant and component stages once', () => {
    const calls: string[] = [];
    const component = { variants: [{ id: 'a' }, { id: 'b' }] } as unknown as ComponentState;
    runStages(
      [
        { step: 2, name: 'c', per: 'component', run: () => calls.push('component') },
        { step: 1, name: 'v', per: 'variant', run: (variant) => calls.push((variant as unknown as { id: string }).id) },
      ],
      component,
    );
    expect(calls).toEqual(['a', 'b', 'component']);
  });
});

describe('settings', () => {
  it('holds the 16 §3 defaults, frozen', () => {
    expect(DEFAULT_MAPPER_SETTINGS.layout.tolerancePx).toBe(0.6);
    expect(DEFAULT_MAPPER_SETTINGS.grid).toEqual({ maxColumns: 8, gap: 24, padding: 32 });
    expect(Object.isFrozen(DEFAULT_MAPPER_SETTINGS.mapper.alignment)).toBe(true);
    expect(settingsProblem(DEFAULT_MAPPER_SETTINGS)).toBeUndefined();
  });

  it('names the first unusable value', () => {
    const cases = [
      settings((s) => ({ ...s, layout: { ...s.layout, tolerancePx: Number.NaN } })),
      settings((s) => ({ ...s, mapper: { ...s.mapper, alignment: { maxPlaceholdersRatio: 2 } } })),
      settings((s) => ({ ...s, grid: { ...s.grid, maxColumns: 0 } })),
      settings((s) => ({ ...s, grid: { ...s.grid, padding: -1 } })),
    ];
    expect(cases.map(settingsProblem)).toEqual([
      expect.stringContaining('layout.tolerancePx'),
      expect.stringContaining('maxPlaceholdersRatio'),
      expect.stringContaining('maxColumns'),
      expect.stringContaining('padding'),
    ]);
  });
});

describe('set grid (06 §3.2)', () => {
  const source = { kind: 'arg', classification: 'VARIANT', evidence: 'declared' } as const;
  const axis = (key: string, values: string[]): ScenePropertyDef => ({
    type: 'VARIANT',
    key,
    name: key,
    values,
    defaultValue: values[0] ?? '',
    source,
  });
  const properties = [axis('size', ['S', 'M', 'L']), axis('state', ['Default', 'Hover'])];
  const all = ['S', 'M', 'L'].flatMap((size) => ['Default', 'Hover'].map((state) => ({ size, state })));

  it('places variants by the mixed-radix index of their column and row values', () => {
    const grid = placeVariants({
      properties,
      layoutGrid: { columns: ['size'], rows: ['state'] },
      variants: all,
      maxColumns: 8,
    });
    expect(grid.columnsBy).toEqual(['size']);
    expect(grid.rowsBy).toEqual(['state']);
    expect(grid.cells).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 2 },
    ]);
  });

  it('wraps columns beyond maxColumns onto extra rows', () => {
    const grid = placeVariants({
      properties,
      layoutGrid: { columns: ['size', 'state'], rows: [] },
      variants: all,
      maxColumns: 4,
    });
    expect(grid.cells).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 0, col: 3 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  it('fills the grid in plan order when the axes leave variants sharing a cell', () => {
    const grid = placeVariants({
      properties,
      layoutGrid: { columns: ['size'], rows: [] },
      variants: all,
      maxColumns: 4,
    });
    expect(grid.columnsBy).toEqual([]);
    expect(grid.cells.slice(3, 5)).toEqual([
      { row: 0, col: 3 },
      { row: 1, col: 0 },
    ]);
  });
});

describe('determinism (BUILD §3.1 rule 4)', () => {
  it('reads no clock, random source or environment', () => {
    const root = new URL('../src/', import.meta.url);
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(new URL(file, root), 'utf8');
      expect(text, file).not.toMatch(/\bDate\b|Math\.random|performance\.now|\bprocess\.|\bcrypto\b|\bIntl\b/);
    }
  });

  it('maps the same input to the same output', () => {
    const input = singleInput(loadCapture('card'));
    expect(JSON.stringify(mapComponent(input))).toBe(JSON.stringify(mapComponent(input)));
  });
});
