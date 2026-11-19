/** S-16 · Instance properties → args: one run in a scratch file. */
import { type SpikeDefinition, taskClient } from '../_shared/spike.ts';
import type { PropertyKind } from './cases.ts';
import type { CaseRow, s16Tasks } from './plugin.ts';

const KINDS: readonly PropertyKind[] = ['VARIANT', 'BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'nested'];

/** Reversibility table: per property kind, how many cases round-tripped to the same instance. */
export function summarize(rows: readonly CaseRow[]) {
  const reversibility: Record<string, { cases: number; roundTrip: number; failed: string[] }> = {};
  for (const kind of KINDS) {
    const relevant = rows.filter((row) => row.kinds.includes(kind) && row.deviations.length === 0);
    reversibility[kind] = {
      cases: relevant.length,
      roundTrip: relevant.filter((row) => row.roundTrip).length,
      failed: relevant.filter((row) => !row.roundTrip).map((row) => row.id),
    };
  }
  const gaps = new Map<string, string>();
  for (const row of rows)
    for (const entry of row.unmapped) gaps.set(`${entry.key}=${JSON.stringify(entry.figma)}`, row.id);
  const fields = new Set<string>();
  for (const row of rows)
    for (const deviation of row.deviations)
      for (const field of deviation.fields) fields.add(`${deviation.role}.${field}`);
  return {
    reversibility: { ...reversibility, SLOT: 'not tested in the slice (hardening, B-30)' },
    valueMapGaps: [...gaps.keys()].sort(),
    overridesOutsideProperties: [...fields].sort(),
    surprises: rows.filter((row) => row.surprise.length > 0 || row.error || row.applyError).map((row) => row.id),
  };
}

export const s16: SpikeDefinition = {
  id: 'S-16',
  title: 'Instance properties → args',
  question:
    'Does instance properties → args → rebuilt instance give the same instance, and which overrides fall outside properties?',
  userTime: '10 min',
  steps: [
    {
      id: 'run',
      label: 'Run',
      where: 'the file "Spikes Scratch"',
      before: ['Builds a test button with 20 instances on a new page. Takes under a minute.'],
      after: ['Paste the results in the chat.'],
      run: async (io) => {
        const { rows } = await taskClient<typeof s16Tasks>(io)('S-16/run', null);
        return { results: { answers: summarize(rows), cases: rows } };
      },
    },
  ],
};
