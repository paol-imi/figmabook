/**
 * S-02 override-preservation matrix (10 §11.1): 19 mutations of a main component (rows) ×
 * 13 override kinds on an instance (columns), graded kept / lost / partial. Pure.
 */

export const MUTATIONS = [
  { id: 'M01', key: 'property-change', label: 'property change on the overridden nodes (fill, size, effect, text)' },
  { id: 'M02', key: 'rename-layer', label: 'rename layers' },
  { id: 'M03', key: 'reorder', label: 'reorder siblings' },
  { id: 'M04', key: 'reparent', label: 'move into another frame of the same component' },
  { id: 'M05', key: 'wrap', label: 'wrap each node in a new frame' },
  { id: 'M06', key: 'recreate', label: 'remove and re-add with the same name (new id)' },
  { id: 'M07', key: 'type-change', label: 'type change (rect→frame, frame→text, ellipse→rect, star→polygon)' },
  { id: 'M08', key: 'layout-mode', label: 'change the parent layoutMode' },
  { id: 'M09', key: 'add-sibling', label: 'add a sibling' },
  { id: 'M10', key: 'remove-sibling', label: 'remove a sibling' },
  { id: 'M11', key: 'rename-variant-value', label: 'rename a variant value' },
  { id: 'M12', key: 'rename-axis', label: 'rename an axis (editComponentProperty)' },
  { id: 'M13', key: 'add-axis', label: 'add an axis' },
  { id: 'M14', key: 'append-variant', label: 'set.appendChild(new variant)' },
  { id: 'M15', key: 'rename-property', label: 'rename TEXT/BOOLEAN/INSTANCE_SWAP properties' },
  { id: 'M16', key: 'change-default', label: 'change property default values' },
  { id: 'M17', key: 'move-set', label: 'move the set into a section' },
  { id: 'M18', key: 'variable-value', label: 'change a bound variable value' },
  { id: 'M19', key: 'swap-nested', label: 'swapComponent of a nested instance in the main component' },
] as const;

export const OVERRIDES = [
  { id: 'O01', key: 'fill', label: 'fill color', role: 'box' },
  { id: 'O02', key: 'stroke', label: 'stroke', role: 'box' },
  { id: 'O03', key: 'effect', label: 'effect', role: 'card' },
  { id: 'O04', key: 'opacity', label: 'opacity', role: 'dot' },
  { id: 'O05', key: 'visibility', label: 'visibility', role: 'star' },
  { id: 'O06', key: 'text-characters', label: 'text characters (raw)', role: 'caption' },
  { id: 'O07', key: 'text-range', label: 'text style range', role: 'caption' },
  { id: 'O08', key: 'text-property', label: 'TEXT property value', role: 'label' },
  { id: 'O09', key: 'boolean-property', label: 'BOOLEAN property value', role: 'icon' },
  { id: 'O10', key: 'instance-swap', label: 'INSTANCE_SWAP value', role: 'icon' },
  { id: 'O11', key: 'nested-property', label: "nested instance's own property", role: 'badge' },
  { id: 'O12', key: 'resize', label: 'resized instance (fixed width)', role: 'root' },
  { id: 'O13', key: 'added-layer', label: 'layer added inside the instance', role: 'root' },
] as const;

export type MutationId = (typeof MUTATIONS)[number]['id'];
export type OverrideId = (typeof OVERRIDES)[number]['id'];
export type OverrideKey = (typeof OVERRIDES)[number]['key'];

/** A short comparable reading of one override's target. Compound readings grade "partial". */
export type Signature = string | Readonly<Record<string, string>>;

export type Grade = 'kept' | 'lost' | 'partial' | 'ambiguous' | 'not-applied' | 'missing' | 'error';

export const GRADE_CODES: Readonly<Record<Grade, string>> = {
  kept: 'K',
  lost: 'L',
  partial: 'P',
  ambiguous: 'A',
  'not-applied': 'N',
  missing: 'M',
  error: 'E',
};

function same(a: Signature | null, b: Signature | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type GradeInput = {
  /** What the instance showed before the override (the main's value then). */
  readonly baseline: Signature | null;
  /** What the instance showed right after the override was applied; null when applying threw. */
  readonly override: Signature | null;
  /** What the instance shows now, after the mutation; null when the target is gone. */
  readonly now: Signature | null;
  /** What the main component shows now (null when it cannot be read, e.g. remote). */
  readonly mainNow: Signature | null;
};

export function grade(input: GradeInput): Grade {
  const { baseline, override, now, mainNow } = input;
  if (override === null || same(override, baseline)) return 'not-applied';
  if (now === null) return 'missing';
  if (same(now, override)) return mainNow !== null && same(mainNow, override) ? 'ambiguous' : 'kept';
  if (typeof now === 'object' && typeof override === 'object') {
    const keys = Object.keys(override);
    const kept = keys.filter((key) => now[key] === override[key]).length;
    if (kept > 0) return 'partial';
  }
  return 'lost';
}

export type CellReading = {
  readonly mutation: MutationId;
  readonly override: OverrideId;
  readonly now: Signature | null;
  readonly mainNow: Signature | null;
  readonly error: string | null;
};

export type CellRecord = {
  readonly mutation: MutationId;
  readonly override: OverrideId;
  readonly instanceId: string;
  readonly baseline: Signature | null;
  readonly applied: Signature | null;
  readonly applyError: string | null;
};

export type MutationStatus = {
  readonly applied: boolean;
  readonly notes: readonly string[];
  readonly error: string | null;
};

export type MatrixRow = {
  readonly mutation: MutationId;
  readonly label: string;
  readonly mutationApplied: boolean | null;
  readonly mutationNotes: readonly string[];
  /** One letter per override O01…O13: K kept, L lost, P partial, A ambiguous, N not applied, M missing, E error. */
  readonly codes: string;
  readonly grades: Readonly<Record<string, Grade>>;
};

export type Matrix = {
  readonly legend: string;
  readonly columns: readonly string[];
  readonly rows: readonly MatrixRow[];
  /** Cells that were not kept, with the readings, so the analysis can see what happened. */
  readonly details: readonly {
    readonly cell: string;
    readonly grade: Grade;
    readonly override: Signature | null;
    readonly now: Signature | null;
    readonly mainNow: Signature | null;
    readonly error: string | null;
  }[];
  readonly summary: {
    readonly kept: number;
    readonly lost: number;
    readonly partial: number;
    readonly other: number;
    /** Mutations that kept every override that could be applied: safe for in-place apply. */
    readonly safeMutations: readonly string[];
    readonly unsafeMutations: readonly string[];
  };
};

export function buildMatrix(
  records: readonly CellRecord[],
  readings: readonly CellReading[],
  mutationStatus: Readonly<Partial<Record<MutationId, MutationStatus>>>,
): Matrix {
  const rows: MatrixRow[] = [];
  const details: Matrix['details'][number][] = [];
  let kept = 0;
  let lost = 0;
  let partial = 0;
  let other = 0;
  for (const mutation of MUTATIONS) {
    const grades: Record<string, Grade> = {};
    let codes = '';
    for (const column of OVERRIDES) {
      const record = records.find((entry) => entry.mutation === mutation.id && entry.override === column.id);
      const reading = readings.find((entry) => entry.mutation === mutation.id && entry.override === column.id);
      const result: Grade =
        !record || !reading
          ? 'missing'
          : reading.error !== null && reading.now === null
            ? 'error'
            : grade({
                baseline: record.baseline,
                override: record.applied,
                now: reading.now,
                mainNow: reading.mainNow,
              });
      grades[column.id] = result;
      codes += GRADE_CODES[result];
      if (result === 'kept') kept++;
      else if (result === 'lost') lost++;
      else if (result === 'partial') partial++;
      else other++;
      if (result !== 'kept') {
        details.push({
          cell: `${mutation.id}.${column.id}`,
          grade: result,
          override: record?.applied ?? null,
          now: reading?.now ?? null,
          mainNow: reading?.mainNow ?? null,
          error: reading?.error ?? record?.applyError ?? null,
        });
      }
    }
    const status = mutationStatus[mutation.id];
    rows.push({
      mutation: mutation.id,
      label: mutation.label,
      mutationApplied: status ? status.applied : null,
      mutationNotes: status ? [...status.notes, ...(status.error ? [status.error] : [])] : [],
      codes,
      grades,
    });
  }
  const isSafe = (row: MatrixRow) =>
    row.mutationApplied === true &&
    Object.values(row.grades).every((value) => value === 'kept' || value === 'not-applied' || value === 'ambiguous');
  return {
    legend:
      'K kept, L lost, P partial, A ambiguous (override equals the new main value), N override could not be applied, M target missing, E read error',
    columns: OVERRIDES.map((column) => `${column.id} ${column.label}`),
    rows,
    details,
    summary: {
      kept,
      lost,
      partial,
      other,
      safeMutations: rows.filter(isSafe).map((row) => row.mutation),
      unsafeMutations: rows.filter((row) => row.mutationApplied === true && !isSafe(row)).map((row) => row.mutation),
    },
  };
}
