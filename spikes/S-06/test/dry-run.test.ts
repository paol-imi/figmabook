// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { envelopeSchema } from '../../_shared/schema.ts';
import { connect, runDry, schemaErrors } from '../../runner/test/support/harness.ts';
import { S06Answers } from '../schema.ts';
import { s06 } from '../steps.ts';

describe('S-06 step 1 dry run', () => {
  it('answers every quick-check question in a valid envelope', async () => {
    const connected = connect();
    const run = await runDry(connected, s06, 'step1', () => ({ choice: 'yes', note: '' }));
    expect(run.envelope.status).toBe('done');
    expect(schemaErrors(envelopeSchema('S-06', 'step1', S06Answers.step1), run.envelope)).toEqual([]);
    const answers = run.envelope.results.answers as Record<string, unknown>;
    expect(answers).toMatchObject({
      setTimeoutInMain: true,
      cryptoSubtleInMain: true,
      cryptoSubtleDigestInMain: true,
      fileKeyReadable: true,
      blobDownloadFromUi: 'yes',
      postMessageMaxOkBytes: { largestTried: 32 * 1024 * 1024 },
    });
  }, 60_000);

  it('never puts the file key itself in the results', async () => {
    const connected = connect({ fileKey: 'SecretFileKey123456' });
    const run = await runDry(connected, s06, 'step1');
    expect(JSON.stringify(run.envelope)).not.toContain('SecretFileKey123456');
  }, 60_000);
});
