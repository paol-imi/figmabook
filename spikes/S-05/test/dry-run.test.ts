// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { envelopeSchema } from '../../_shared/schema.ts';
import { connect, runDry, schemaErrors } from '../../runner/test/support/harness.ts';
import { CASES } from '../cases.ts';
import { S05Answers } from '../schema.ts';
import { s05 } from '../steps.ts';

describe('S-05 dry run', () => {
  it('builds every case for both models and answers in a valid envelope', async () => {
    const run = await runDry(connect(), s05, 'run');
    expect(run.envelope.status, JSON.stringify(run.envelope.results)).toBe('done');
    expect(schemaErrors(envelopeSchema('S-05', 'run', S05Answers.run), run.envelope)).toEqual([]);
    const cases = run.envelope.results.cases as Array<{ caseId: string; model: string; child: unknown }>;
    expect(cases).toHaveLength(CASES.length * 2);
    expect(cases.every((entry) => entry.child !== null)).toBe(true);
  });

  it('the designer check reads the edited A/B frames and records the choice', async () => {
    const connected = connect();
    await runDry(connected, s05, 'run');
    const run = await runDry(connected, s05, 'designer', (question) =>
      question.kind === 'choice'
        ? { choice: 'B', note: '  B moved the label, as in CSS.  ' }
        : { choice: 'continue', note: '' },
    );
    expect(schemaErrors(envelopeSchema('S-05', 'designer', S05Answers.designer), run.envelope)).toEqual([]);
    expect(run.envelope.results.answers).toEqual({ designerChoice: 'B', reason: 'B moved the label, as in CSS.' });
    expect(run.envelope.results.edit).toMatchObject({
      A: { strokesIncludedInLayout: false },
      B: { strokesIncludedInLayout: true },
    });
  });
});
