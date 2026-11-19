import { describe, expect, it } from 'vitest';
import { envelopeSchema } from '../../_shared/schema.ts';
import { connect, runDry, schemaErrors } from '../../runner/test/support/harness.ts';
import { STEP_IDS } from '../markers.ts';
import { S17Answers } from '../schema.ts';
import { s17 } from '../steps.ts';

describe('S-17 dry run (one fake file stands in for main and branch)', () => {
  it('runs all five steps and reports survival of every marker', async () => {
    const connected = connect({ fileKey: 'MainFileKey0000000001' });
    for (const step of STEP_IDS) {
      // The branch has its own file key; steps 2 and 4 run there.
      Reflect.set(
        connected.dryRun.figma,
        'fileKey',
        step === 'step2' || step === 'step4' ? 'BranchFileKey00000001' : 'MainFileKey0000000001',
      );
      const run = await runDry(connected, s17, step);
      expect(run.envelope.status, JSON.stringify(run.envelope.results)).toBe('done');
      expect(schemaErrors(envelopeSchema('S-17', step, S17Answers[step]), run.envelope)).toEqual([]);
      if (step === 'step5') {
        expect(run.envelope.results.answers).toMatchObject({
          // In one fake file everything is visible everywhere, so every check reads "yes".
          onCreate: { root: 'yes', component: 'yes', chunk90kB: { root: 'intact', component: 'intact' } },
          onUpdateFromMain: { mainWritesArrived: 'yes', branchWritesKept: 'yes', editValue: 'branch' },
          onMerge: { branchWritesArrived: 'yes', mainWritesKept: 'yes', step1MarkersKept: 'yes' },
          fileKey: { branchHasOwnKey: true, mainKeyStable: true },
          stepsRun: [...STEP_IDS],
        });
        expect(Object.keys(run.envelope.results.readouts ?? {})).toEqual([...STEP_IDS]);
      }
    }
    expect(JSON.stringify(connected.dryRun.figma.root.getSharedPluginDataKeys('holotype_spikes'))).toContain(
      's17.base.0',
    );
  });

  it('tells the user when Step 2 ran in the main file instead of the branch', async () => {
    const connected = connect({ fileKey: 'SameKey00000000000001' });
    await runDry(connected, s17, 'step1');
    const run = await runDry(connected, s17, 'step2');
    expect(run.notes.join(' ')).toMatch(/not the branch/);
  });

  it('fails with a clear message when Step 2 runs before Step 1', async () => {
    const run = await runDry(connect(), s17, 'step2');
    expect(run.envelope.status).toBe('done');
    expect(run.notes.join(' ')).toMatch(/Run Step 1 in the main file first/);
  });
});
