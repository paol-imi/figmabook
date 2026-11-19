import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStorybook } from '../../../../fixtures/ds-react/test/support/storybook.ts';

/** The built `holotype` binary (the global setup builds it). */
export const HOLOTYPE_BIN = fileURLToPath(new URL('../../bin/holotype.js', import.meta.url));

export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs `holotype <args>` in a child process, as a user would. `HOLOTYPE_CHROMIUM_PATH` and
 * `PLAYWRIGHT_BROWSERS_PATH` pass through; `CI` and `NO_COLOR` keep the output plain.
 */
export function holotype(
  args: readonly string[],
  options: { cwd: string; env?: Record<string, string> },
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [HOLOTYPE_BIN, ...args],
      {
        cwd: options.cwd,
        env: { ...process.env, NO_COLOR: '1', CI: 'true', ...options.env },
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') reject(error);
        else resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
      },
    );
  });
}

/** The fixture Storybook as a static build: `HOLOTYPE_STORYBOOK_STATIC`, or built into a temp folder. */
export interface FixtureBuild {
  readonly dir: string;
  close(): Promise<void>;
}

export async function fixtureStorybook(): Promise<FixtureBuild> {
  const prebuilt = process.env.HOLOTYPE_STORYBOOK_STATIC;
  if (prebuilt !== undefined && prebuilt !== '') return { dir: prebuilt, close: async () => undefined };
  const parent = await mkdtemp(join(tmpdir(), 'holotype-sb-'));
  const dir = join(parent, 'storybook-static');
  await buildStorybook(dir);
  return { dir, close: () => rm(parent, { recursive: true, force: true }) };
}
