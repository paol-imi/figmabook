/** S-17 · Branches and plugin data: five short steps across the main file and its branch. */
import { type SpikeDefinition, type StepDefinition, type StepIO, taskClient } from '../_shared/spike.ts';
import { analyze, type Readout, type StepId } from './markers.ts';
import type { s17Tasks } from './plugin.ts';

const READOUTS_KEY = 'readouts';

async function runMarkerStep(io: StepIO, step: StepId) {
  const call = taskClient<typeof s17Tasks>(io);
  const readout = await call('S-17/step', { step });
  const stored = (await io.state.get<Partial<Record<StepId, Readout>>>(READOUTS_KEY)) ?? {};
  const readouts = { ...stored, [step]: readout };
  await io.state.set(READOUTS_KEY, readouts);
  const { branchApis } = step === 'step1' ? await call('S-17/apis', null) : { branchApis: null };
  const answers = analyze(readouts);
  const notes: string[] = [];
  if (readout.errors.length > 0) notes.push(`Problem: ${readout.errors.join(' ')}`);
  if (step === 'step2' && answers.fileKey.branchHasOwnKey === false) {
    notes.push('This looks like the main file, not the branch. Open the branch "spike-s17" and run Step 2 there.');
  }
  return {
    results: step === 'step5' ? { answers, readouts, branchApis } : { answers, readout, branchApis },
    notes,
  };
}

const step = (id: StepId, label: string, where: string, before: string[], after: string[]): StepDefinition => ({
  id,
  label,
  where,
  before,
  after,
  run: (io) => runMarkerStep(io, id),
});

export const s17: SpikeDefinition = {
  id: 'S-17',
  title: 'Branches and plugin data',
  question: 'Do Figma branches keep plugin data when a branch is created, updated from main, and merged?',
  userTime: '20 min',
  steps: [
    step(
      'step1',
      'Step 1',
      'the main file "Spikes Library" (Organization account)',
      [],
      ['Next: File menu ▸ Create branch…, name it "spike-s17". In the branch, run Step 2.'],
    ),
    step('step2', 'Step 2', 'the branch "spike-s17"', [], ['Next: go back to the main file and run Step 3.']),
    step(
      'step3',
      'Step 3',
      'the main file "Spikes Library"',
      [],
      ['Next: open the branch. Accept "Update from main" when Figma offers it, then run Step 4.'],
    ),
    step(
      'step4',
      'Step 4',
      'the branch "spike-s17", after "Update from main"',
      [],
      ['Next: merge the branch (Review and merge ▸ Merge). Then, in the main file, run Step 5.'],
    ),
    step(
      'step5',
      'Step 5',
      'the main file "Spikes Library", after the merge',
      [],
      ['Copy results and paste them in the chat. This block has all five steps.'],
    ),
  ],
};
