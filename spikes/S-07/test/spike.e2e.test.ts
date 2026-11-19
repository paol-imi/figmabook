import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Results } from '../results.ts';

/**
 * A short S-07 run in headless Chromium: 20 variants of fixtures/ds-react through every loop
 * configuration plus capture parity, and the first faults on the generated sandbox. Needs
 * `pnpm build` (the CLI imports the built packages) and the local pnpm store for the sandbox.
 */
const run = promisify(execFile);
const spikes = fileURLToPath(new URL('../..', import.meta.url));
let dir: string;
let results: Results;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'holotype-s07-e2e-'));
  const out = join(dir, 'results.json');
  await run(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      'S-07/cli.ts',
      'loop',
      'parity',
      'faults',
      '--variants',
      '20',
      '--out',
      out,
    ],
    { cwd: spikes, maxBuffer: 16 * 1024 * 1024, timeout: 280_000 },
  );
  results = JSON.parse(await readFile(out, 'utf8')) as Results;
}, 300_000);

afterAll(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

describe('S-07 short run', () => {
  it('renders every variant in every loop, the channel faster than the URL path', () => {
    expect(results.loops.map((loop) => [loop.name, loop.failures])).toEqual(
      results.loops.map((loop) => [loop.name, 0]),
    );
    const channel = results.loops.find((loop) => loop.name === 'channel');
    const url = results.loops.find((loop) => loop.name === 'url');
    expect(channel?.throughput).toBeGreaterThan(url?.throughput ?? Number.POSITIVE_INFINITY);
  });

  it('captures the same documents through both drivers, except React useId values', () => {
    const parity = results.parity;
    expect(parity?.sample).toBe(4);
    expect(parity?.equalIgnoringReactIds).toBe(4);
    for (const record of parity?.records ?? []) {
      if (!record.equal) expect(record.difference).toMatch(/\.source\.id \("_r_\d+_/);
    }
  });

  it('detects the injected faults and recovers from them', () => {
    const channel = results.faults.find((run) => run.driver === 'channel');
    expect(channel?.faults.map((fault) => [fault.kind, fault.detected, fault.recovered])).toEqual([
      ['throws', true, true],
      ['throws-args', true, true],
    ]);
    expect(channel?.healthyFailures).toBe(0);
  });
});
