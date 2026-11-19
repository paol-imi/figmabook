/**
 * S-19 coverage: per component and per field group, the share of fields whose provenance resolves
 * to a verified `file:line:col`, the `var()` chains that reach located definitions, and the
 * failures by reason. Pure; `run.ts` collects the records.
 */
import type { FieldVerdict } from './oracle.ts';
import type { FieldProvenance } from './resolver/resolve.ts';

export interface FieldRecord {
  readonly storyId: string;
  readonly theme: 'light' | 'dark';
  /** Component id (`sid`), e.g. `components-button`. */
  readonly component: string;
  /** Capture IR node id and path. */
  readonly nodeId: string;
  readonly path: string;
  readonly kind: 'element' | 'text';
  readonly field: FieldProvenance;
  readonly verdict: FieldVerdict;
}

export interface CoverageRow {
  readonly key: string;
  readonly fields: number;
  /** Source-mapped and verified at the declaration. */
  readonly resolved: number;
  /** `dev-id` sheets: file right and line verified. */
  readonly approximateOk: number;
  readonly approximateWrong: number;
  readonly selectorOnly: number;
  readonly unresolved: number;
  /** Fields whose value comes from a `var()` (a chain was resolved, or the reference is ambiguous). */
  readonly withVar: number;
  /** …whose chain names all resolve to a definition (located or not). */
  readonly chainResolved: number;
  /** …located, and whose chain reaches a located, verified definition for every name. */
  readonly chainComplete: number;
  /** Source-mapped locations (rule or definition) that fail the ground-truth check. Must be 0. */
  readonly wrongFile: number;
  readonly wrongSelector: number;
  /** Winner whose literal or chain terminal equals the computed value (the rest: `unknown`). */
  readonly valueMatch: number;
  /** Winner whose literal or chain terminal does not explain the computed value. Must be 0. */
  readonly valueMismatch: number;
  readonly reasons: Readonly<Record<string, number>>;
}

const pct = (part: number, whole: number) => (whole === 0 ? '–' : `${((100 * part) / whole).toFixed(1)}%`);

function rowOf(key: string, records: readonly FieldRecord[]): CoverageRow {
  let resolved = 0;
  let approximateOk = 0;
  let approximateWrong = 0;
  let selectorOnly = 0;
  let unresolved = 0;
  let withVar = 0;
  let chainComplete = 0;
  let chainResolved = 0;
  let wrongFile = 0;
  let wrongSelector = 0;
  let valueMismatch = 0;
  let valueMatch = 0;
  const reasons: Record<string, number> = {};
  for (const { field, verdict } of records) {
    const mappedWrong = verdict.rule === 'wrong' || verdict.definitions === 'wrong';
    if (field.status === 'resolved') {
      if (mappedWrong) wrongFile++;
      else resolved++;
    } else if (field.status === 'approximate') {
      if (verdict.rule === 'ok') approximateOk++;
      else approximateWrong++;
    } else if (field.status === 'selector-only') {
      selectorOnly++;
    } else {
      unresolved++;
      const reason = field.reason ?? 'unknown';
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    if (verdict.selector === 'wrong') wrongSelector++;
    if (field.valueCheck === 'mismatch') valueMismatch++;
    if (field.valueCheck === 'match') valueMatch++;
    if (field.varChain !== undefined) {
      withVar++;
      if (field.varChain.status === 'complete' || field.varChain.status === 'partial') chainResolved++;
      const located = field.status === 'resolved' || field.status === 'approximate';
      const verified = verdict.rule !== 'wrong' && verdict.definitions !== 'wrong';
      if (field.varChain?.status === 'complete' && verified && located) {
        chainComplete++;
      }
    }
  }
  return {
    key,
    fields: records.length,
    resolved,
    approximateOk,
    approximateWrong,
    selectorOnly,
    unresolved,
    withVar,
    chainResolved,
    chainComplete,
    wrongFile,
    wrongSelector,
    valueMatch,
    valueMismatch,
    reasons: Object.fromEntries(Object.entries(reasons).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

/** Rows grouped by `keyOf`, sorted by key, plus a final `all` row. */
export function summarize(records: readonly FieldRecord[], keyOf: (record: FieldRecord) => string): CoverageRow[] {
  const groups = new Map<string, FieldRecord[]>();
  for (const record of records) {
    const key = keyOf(record);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [record]);
    else group.push(record);
  }
  const keys = [...groups.keys()].sort();
  return [...keys.map((key) => rowOf(key, groups.get(key) ?? [])), rowOf('all', records)];
}

/** A Markdown table of `rows` (the report's coverage tables). */
export function markdownTable(rows: readonly CoverageRow[], label: string): string {
  const header = `| ${label} | fields | resolved | approx. ok / wrong | selector only | unresolved (reasons) | var() chains resolved / located | wrong file | wrong selector | value match / mismatch |`;
  const rule = '|---|--:|--:|--:|--:|---|--:|--:|--:|--:|';
  const lines = rows.map((row) => {
    const reasons = Object.entries(row.reasons)
      .map(([reason, count]) => `${reason} ${count}`)
      .join(', ');
    const name = row.key === 'all' ? '**all**' : `\`${row.key}\``;
    return [
      name,
      row.fields,
      `${row.resolved} (${pct(row.resolved, row.fields)})`,
      row.approximateOk + row.approximateWrong === 0 ? '–' : `${row.approximateOk} / ${row.approximateWrong}`,
      row.selectorOnly === 0 ? '–' : row.selectorOnly,
      row.unresolved === 0 ? '0' : `${row.unresolved} (${reasons})`,
      row.withVar === 0
        ? '–'
        : `${row.chainResolved} / ${row.chainComplete} of ${row.withVar} (${pct(row.chainComplete, row.withVar)} located)`,
      row.wrongFile,
      row.wrongSelector,
      `${row.valueMatch} / ${row.valueMismatch}`,
    ].join(' | ');
  });
  return [header, rule, ...lines.map((line) => `| ${line} |`)].join('\n');
}
