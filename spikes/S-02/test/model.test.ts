import { describe, expect, it } from 'vitest';
import { buildMatrix, type CellReading, type CellRecord, grade, MUTATIONS, OVERRIDES } from '../model.ts';
import { libraryUpdateSeen, placementSummary } from '../steps.ts';

describe('S-02 matrix shape (10 §11.1)', () => {
  it('has the 19 mutation rows and 13 override columns of the plan', () => {
    expect(MUTATIONS.map((row) => row.id)).toEqual(
      Array.from({ length: 19 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`),
    );
    expect(OVERRIDES.map((column) => column.id)).toEqual(
      Array.from({ length: 13 }, (_, i) => `O${String(i + 1).padStart(2, '0')}`),
    );
    expect(new Set(MUTATIONS.map((row) => row.key)).size).toBe(19);
  });
});

describe('grade', () => {
  const base = { baseline: '#3b82f6@1', override: '#ef4444@1', mainNow: '#22c55e@1' };
  it.each([
    ['kept', { ...base, now: '#ef4444@1' }],
    ['lost', { ...base, now: '#22c55e@1' }],
    ['missing', { ...base, now: null }],
    ['not-applied', { ...base, override: null, now: '#3b82f6@1' }],
    ['not-applied', { ...base, override: '#3b82f6@1', now: '#3b82f6@1' }],
    ['ambiguous', { ...base, mainNow: '#ef4444@1', now: '#ef4444@1' }],
  ] as const)('%s', (expected, input) => {
    expect(grade(input)).toBe(expected);
  });

  it('grades a compound reading as partial when only some parts survive', () => {
    expect(
      grade({
        baseline: { prop: 'Label', text: 'Label' },
        override: { prop: 'Custom', text: 'Custom' },
        now: { prop: 'Custom', text: 'Label' },
        mainNow: { prop: 'Label', text: 'Label' },
      }),
    ).toBe('partial');
  });
});

describe('buildMatrix', () => {
  const records: CellRecord[] = MUTATIONS.flatMap((mutation) =>
    OVERRIDES.map((column) => ({
      mutation: mutation.id,
      override: column.id,
      instanceId: `${mutation.id}-${column.id}`,
      baseline: 'main',
      applied: column.id === 'O13' ? null : 'override',
      applyError: column.id === 'O13' ? 'Cannot move node into an instance' : null,
    })),
  );
  const readings: CellReading[] = records.map((record) => ({
    mutation: record.mutation,
    override: record.override,
    now: record.mutation === 'M06' && record.override === 'O01' ? 'main' : 'override',
    mainNow: 'main',
    error: null,
  }));
  const status = Object.fromEntries(
    MUTATIONS.map((mutation) => [mutation.id, { applied: true, notes: [], error: null }]),
  );

  it('writes one letter per cell and lists only the cells that were not kept', () => {
    const matrix = buildMatrix(records, readings, status);
    expect(matrix.rows).toHaveLength(19);
    expect(matrix.rows[0]?.codes).toBe('KKKKKKKKKKKKN');
    expect(matrix.rows.find((row) => row.mutation === 'M06')?.codes).toBe('LKKKKKKKKKKKN');
    expect(matrix.details.map((detail) => detail.cell)).toContain('M06.O01');
    expect(matrix.details.find((detail) => detail.cell === 'M01.O13')?.error).toMatch(/instance/);
    expect(matrix.summary).toMatchObject({ lost: 1, kept: 19 * 12 - 1 });
    expect(matrix.summary.unsafeMutations).toEqual(['M06']);
    expect(matrix.summary.safeMutations).toHaveLength(18);
  });

  it('marks unread cells as missing and failed mutations as neither safe nor unsafe', () => {
    const matrix = buildMatrix(records.slice(0, 13), readings.slice(0, 13), {
      M01: { applied: false, notes: [], error: 'boom' },
    });
    expect(matrix.rows[1]?.codes).toBe('MMMMMMMMMMMMM');
    expect(matrix.rows[0]?.mutationNotes).toEqual(['boom']);
    expect(matrix.summary.safeMutations).toEqual([]);
    expect(matrix.summary.unsafeMutations).toEqual([]);
  });

  it('summarizes placement per override kind with distinct errors', () => {
    const summary = placementSummary(records);
    expect(summary).toHaveLength(13);
    expect(summary[12]).toEqual({
      override: 'O13 layer added inside the instance',
      applied: 0,
      total: 19,
      errors: ['Cannot move node into an instance'],
    });
    expect(summary[0]).toMatchObject({ applied: 19, total: 19, errors: [] });
  });

  it('detects whether the consumer accepted the library update', () => {
    const reading = (mainNow: CellReading['mainNow']): CellReading[] => [
      { mutation: 'M01', override: 'O02', now: null, mainNow, error: null },
    ];
    expect(libraryUpdateSeen(reading({ paint: '#64748b@1', weight: '2' }))).toBe(true);
    expect(libraryUpdateSeen(reading({ paint: '#0f172a@1', weight: '1' }))).toBe(false);
    expect(libraryUpdateSeen([])).toBe(false);
  });
});
