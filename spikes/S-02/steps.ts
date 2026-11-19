/** S-02 · Override preservation: four steps across "Spikes Library" and "Spikes Consumer". */
import { type SpikeDefinition, type StepIO, taskClient } from '../_shared/spike.ts';
import { COLORS } from './fixture.ts';
import {
  buildMatrix,
  type CellReading,
  type CellRecord,
  type MutationId,
  type MutationStatus,
  OVERRIDES,
} from './model.ts';
import type { SharedInfo, SubjectInfo, s02Tasks } from './plugin.ts';

type LibraryState = { shared: SharedInfo; subjects: SubjectInfo[]; records: CellRecord[] };
type ConsumerState = { records: CellRecord[] };
type MutationState = Partial<Record<MutationId, MutationStatus>>;

const KEYS = { library: 'library', consumer: 'consumer', mutations: 'mutations' } as const;

/** Which override kinds could be applied at all (an override Figma refuses is a result too). */
export function placementSummary(records: readonly CellRecord[]) {
  return OVERRIDES.map((column) => {
    const cells = records.filter((record) => record.override === column.id);
    const errors = [
      ...new Set(cells.map((cell) => cell.applyError).filter((error): error is string => error !== null)),
    ];
    return {
      override: `${column.id} ${column.label}`,
      applied: cells.filter(
        (cell) => cell.applied !== null && JSON.stringify(cell.applied) !== JSON.stringify(cell.baseline),
      ).length,
      total: cells.length,
      errors,
    };
  });
}

/** True when the consumer sees the M01 fill change, i.e. the library update was accepted. */
export function libraryUpdateSeen(readings: readonly CellReading[]): boolean {
  const probe = readings.find((reading) => reading.mutation === 'M01' && reading.override === 'O02');
  return (
    probe !== undefined &&
    JSON.stringify(probe.mainNow) === JSON.stringify({ paint: `${COLORS.strokeMutated}@1`, weight: '2' })
  );
}

async function needState<T>(io: StepIO, key: string, message: string): Promise<T> {
  const value = await io.state.get<T>(key);
  if (value === undefined) throw new Error(message);
  return value;
}

export const s02: SpikeDefinition = {
  id: 'S-02',
  title: 'Override preservation',
  question:
    'Which in-place edits of a main component keep instance overrides, in the same file and through a library update?',
  userTime: '40 min',
  steps: [
    {
      id: 'step1',
      label: 'Step 1 (build)',
      where: 'the file "Spikes Library"',
      before: ['Builds 19 test component sets and 247 instances on a new page. Takes a minute or two.'],
      after: [
        'Now publish the library: Assets ▸ Libraries ▸ Publish.',
        'Then open "Spikes Consumer", turn on the library (Assets ▸ Libraries) and run Step 2 there.',
      ],
      run: async (io) => {
        const built = await taskClient<typeof s02Tasks>(io)('S-02/build', null);
        await io.state.set(KEYS.library, built satisfies LibraryState);
        return {
          results: { answers: { sameFilePlacement: placementSummary(built.records) }, subjects: built.subjects.length },
        };
      },
    },
    {
      id: 'step2',
      label: 'Step 2 (place instances)',
      where: 'the file "Spikes Consumer", with "Spikes Library" turned on',
      before: ['Places 247 instances from the published library on a new page.'],
      after: ['Next: go back to "Spikes Library" and run Step 3.'],
      run: async (io) => {
        const library = await needState<LibraryState>(
          io,
          KEYS.library,
          'Run Step 1 in "Spikes Library" first (on this computer).',
        );
        const placed = await taskClient<typeof s02Tasks>(io)('S-02/place', {
          shared: library.shared,
          subjects: library.subjects,
        });
        await io.state.set(KEYS.consumer, { records: placed.records } satisfies ConsumerState);
        return {
          results: {
            answers: { consumerPlacement: placementSummary(placed.records) },
            importErrors: placed.importErrors,
          },
        };
      },
    },
    {
      id: 'step3',
      label: 'Step 3 (mutate)',
      where: 'the file "Spikes Library"',
      before: ['Edits the 19 main components in place, then checks the instances in this file.'],
      after: [
        'Paste the results in the chat (this is the same-file matrix).',
        'Then publish again: Assets ▸ Libraries ▸ Publish.',
        'Then in "Spikes Consumer": accept the update ("Updates available" ▸ Update all) and run Step 4.',
      ],
      run: async (io) => {
        const call = taskClient<typeof s02Tasks>(io);
        const library = await needState<LibraryState>(io, KEYS.library, 'Run Step 1 in this file first.');
        const { status } = await call('S-02/mutate', { shared: library.shared, subjects: library.subjects });
        await io.state.set(KEYS.mutations, status satisfies MutationState);
        const { readings } = await call('S-02/read', { records: library.records, subjects: library.subjects });
        const matrix = buildMatrix(library.records, readings, status);
        return { results: { answers: { scope: 'same-file', summary: matrix.summary }, matrix } };
      },
    },
    {
      id: 'step4',
      label: 'Step 4 (read)',
      where: 'the file "Spikes Consumer", after "Update all"',
      before: ['Checks the 247 instances after the library update.'],
      after: ['Paste the results in the chat. That completes S-02.'],
      run: async (io) => {
        const library = await needState<LibraryState>(io, KEYS.library, 'Run Step 1 in "Spikes Library" first.');
        const consumer = await needState<ConsumerState>(io, KEYS.consumer, 'Run Step 2 in this file first.');
        const status = (await io.state.get<MutationState>(KEYS.mutations)) ?? {};
        const { readings } = await taskClient<typeof s02Tasks>(io)('S-02/read', {
          records: consumer.records,
          subjects: library.subjects,
        });
        const matrix = buildMatrix(consumer.records, readings, status);
        const seen = libraryUpdateSeen(readings);
        return {
          notes: seen
            ? []
            : [
                'The library update does not seem to be accepted yet. Click "Update all" in this file, then run Step 4 again.',
              ],
          results: { answers: { scope: 'library', libraryUpdateSeen: seen, summary: matrix.summary }, matrix },
        };
      },
    },
  ],
};
