import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { envelopeSchema } from '../../_shared/schema.ts';
import { connect, runDry, schemaErrors } from '../../runner/test/support/harness.ts';
import { S02Answers, S02Matrix } from '../schema.ts';
import { s02 } from '../steps.ts';

describe('S-02 dry run (one fake file stands in for library and consumer)', () => {
  it('runs the four steps and produces both matrices', async () => {
    const connected = connect();
    for (const step of ['step1', 'step2', 'step3', 'step4'] as const) {
      const run = await runDry(connected, s02, step);
      expect(run.envelope.status, JSON.stringify(run.envelope.results)).toBe('done');
      expect(schemaErrors(envelopeSchema('S-02', step, S02Answers[step]), run.envelope)).toEqual([]);
      if (step === 'step3' || step === 'step4') {
        expect(Value.Check(S02Matrix, run.envelope.results.matrix)).toBe(true);
        // Every mutation must run in the fake; a failure here is a bug in the spike, not a finding.
        const rows = (run.envelope.results.matrix as { rows: Array<{ mutation: string; mutationApplied: boolean }> })
          .rows;
        expect(rows.filter((row) => !row.mutationApplied).map((row) => row.mutation)).toEqual([]);
      }
      if (step === 'step4') expect(run.envelope.results.answers).toMatchObject({ libraryUpdateSeen: true });
    }
  });

  it('records that Figma refuses a layer added inside an instance (column O13)', async () => {
    const run = await runDry(connect(), s02, 'step1');
    const placement = (
      run.envelope.results.answers as {
        sameFilePlacement: Array<{ override: string; applied: number; errors: string[] }>;
      }
    ).sameFilePlacement;
    const added = placement.find((entry) => entry.override.startsWith('O13'));
    expect(added?.applied).toBe(0);
    expect(added?.errors.join(' ')).toMatch(/instance/);
  });

  it('asks for Step 1 first when the consumer step runs on a fresh computer', async () => {
    const run = await runDry(connect(), s02, 'step2');
    expect(run.envelope.status).toBe('failed');
    expect(run.envelope.results.error).toMatch(/Run Step 1/);
  });
});
