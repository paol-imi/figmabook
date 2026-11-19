import { describe, expect, it } from 'vitest';
import { envelopeSchema } from '../../_shared/schema.ts';
import { connect, runDry, schemaErrors } from '../../runner/test/support/harness.ts';
import { BINDINGS } from '../fields.ts';
import { S12Answers } from '../schema.ts';
import { s12 } from '../steps.ts';

describe('S-12 dry run', () => {
  it('step 1 binds every 08 §8 field and finds the mode limit', async () => {
    const connected = connect({ modeLimit: 4 });
    const run = await runDry(connected, s12, 'step1', () => ({ choice: 'organization', note: '' }));
    expect(run.envelope.status, JSON.stringify(run.envelope.results)).toBe('done');
    expect(schemaErrors(envelopeSchema('S-12', 'step1', S12Answers.step1), run.envelope)).toEqual([]);
    expect(run.envelope.results.answers).toMatchObject({
      plan: 'organization',
      modeLimit: 4,
      bindableFields: { failed: [], total: BINDINGS.length },
      aliasAcrossCollections: true,
      explicitModes: true,
    });
  });

  it('step 2 imports the library variables by key and matches them by codeSyntax.WEB', async () => {
    const connected = connect();
    await runDry(connected, s12, 'step1');
    const run = await runDry(connected, s12, 'step2');
    expect(run.envelope.status, JSON.stringify(run.envelope.results)).toBe('done');
    expect(schemaErrors(envelopeSchema('S-12', 'step2', S12Answers.step2), run.envelope)).toEqual([]);
    expect(run.envelope.results.answers).toMatchObject({
      libraryCollectionsListed: true,
      codeSyntaxWebMatching: { unmatched: [] },
      bindImportedVariable: { fill: true, padding: true },
    });
  });

  it('step 2 explains that step 1 must run first', async () => {
    const run = await runDry(connect(), s12, 'step2');
    expect(run.envelope.status).toBe('failed');
    expect(run.envelope.results.error).toMatch(/Run Step 1/);
  });
});
