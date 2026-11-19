import { describe, expect, it } from 'vitest';
import { envelopeSchema } from '../../_shared/schema.ts';
import { connect, runDry, schemaErrors } from '../../runner/test/support/harness.ts';
import { CASES } from '../cases.ts';
import { S16Answers } from '../schema.ts';
import { s16 } from '../steps.ts';

describe('S-16 dry run', () => {
  it('builds the set, maps all 20 cases and returns the reversibility table', async () => {
    const run = await runDry(connect(), s16, 'run');
    expect(run.envelope.status, JSON.stringify(run.envelope.results)).toBe('done');
    expect(schemaErrors(envelopeSchema('S-16', 'run', S16Answers.run), run.envelope)).toEqual([]);
    const cases = run.envelope.results.cases as Array<{
      id: string;
      error: string | null;
      args: Record<string, unknown>;
    }>;
    expect(cases.map((row) => row.id)).toEqual(CASES.map((testCase) => testCase.id));
    expect(cases.filter((row) => row.error !== null)).toEqual([]);
    expect(cases[0]?.args).toEqual({
      variant: 'primary',
      size: 'medium',
      iconPosition: 'start',
      children: 'Button',
      icon: 'star',
    });
    const answers = run.envelope.results.answers as {
      valueMapGaps: string[];
      reversibility: Record<string, { cases: number }>;
    };
    expect(answers.valueMapGaps).toEqual(['arg:icon="icon-bolt"', 'arg:variant="Danger"']);
    expect(answers.reversibility.VARIANT?.cases).toBeGreaterThan(0);
  });
});
