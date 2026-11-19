import { createHash } from 'node:crypto';
import { NotImplementedError } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import {
  comparedBytes,
  dcrExports,
  extract,
  listCases,
  loadCase,
  renderPrompt,
  requestBytes,
  runPipeline,
  SHUFFLE_SEEDS,
  STAGE_EXPORTS,
  STAGES,
  shuffleInput,
} from '../src/index.ts';

/*
 * The case runner (12 §2.4, D-35): every case runs three times, as is and with two seeded
 * shuffles of its input, and every run must give the same bytes, equal to the golden.
 * Stages that are not built yet are skipped (see `STAGES` in src/pipeline.ts); the guard
 * tests below fail as soon as one is built, so the flag cannot be left behind.
 */

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const cases = listCases();
const pending = (stage: keyof typeof STAGES) => STAGES[stage] === 'pending';

describe('pipeline stages', () => {
  it.runIf(pending('extract'))(
    'extract is pending: extractDcr is still the stub (flip STAGES.extract when B-65 lands)',
    () => {
      const { input } = loadCase(cases[0] as string);
      expect(() => extract(input)).toThrow(NotImplementedError);
    },
  );

  for (const [stage, name] of Object.entries(STAGE_EXPORTS) as Array<[keyof typeof STAGE_EXPORTS, string]>) {
    it.runIf(pending(stage))(
      `${stage} is pending: @holotype/dcr has no ${name} yet (wire it in src/pipeline.ts)`,
      () => {
        expect(dcrExports(name)).toBe(false);
      },
    );
  }
});

describe.each(cases)('%s', (name) => {
  const runs = () => {
    const { input, expected } = loadCase(name);
    const outputs = [input, ...SHUFFLE_SEEDS.map((seed) => shuffleInput(input, seed))].map(runPipeline);
    return { outputs, expected };
  };

  it.skipIf(pending('extract'))(
    '3 runs (as is, 2 seeded shuffles) give byte-identical output equal to expected/dcr.json',
    () => {
      const { outputs, expected } = runs();
      const digests = outputs.map((output) => sha256(requestBytes(output)));
      expect(new Set(digests).size).toBe(1);
      for (const output of outputs) {
        expect(comparedBytes(output)).toBe(comparedBytes(expected.dcr));
        expect(output.dcrHash).toBe(expected.dcr.dcrHash);
        expect(output.id).toBe(expected.dcr.id);
      }
    },
  );

  it.skipIf(pending('extract'))('a re-extraction at another file version gives the same dcrHash and item ids', () => {
    const { input, expected } = loadCase(name);
    const at = (fileVersion: string) => extract({ ...input, branch: { ...input.branch, fileVersion } });
    const first = at('1001');
    const second = at('1002');
    expect(first.header.figma.fileVersion).toBe('1001');
    expect(second.dcrHash).toBe(first.dcrHash);
    expect(first.dcrHash).toBe(expected.dcr.dcrHash);
    expect(second.items.map((item) => item.id)).toEqual(expected.dcr.items.map((item) => item.id));
  });

  const prompt = loadCase(name).expected.prompt;
  it.skipIf(pending('prompt'))('has a prompt golden, not the pending placeholder', () => {
    expect(prompt.pending).toBe(false);
  });

  it.skipIf(pending('prompt') || prompt.pending)('renders expected/prompt.md byte for byte', () => {
    const { expected } = loadCase(name);
    if (expected.prompt.pending) throw new Error('unreachable: the prompt golden is pending');
    expect(renderPrompt(expected.dcr)).toBe(expected.prompt.text);
  });
});
