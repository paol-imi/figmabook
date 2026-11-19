/**
 * Shared steps of the smoke run and the demo kit. Runs under Node type stripping: no
 * TypeScript-only runtime syntax here.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The repository root. */
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Where the smoke run and the demo kit put what they make (git-ignored). */
export const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

/** The stories of demo D1: a row of three boxes and a badge (BUILD B-15). */
export const SMOKE_STORIES = ['micro-flex--row', 'components-badge--default'];

/** Fixed `createdAt` of the smoke bundle, so it has the same bytes on every machine. */
export const SMOKE_EPOCH = '1763546400';

async function pnpm(args: readonly string[]): Promise<void> {
  try {
    await run('pnpm', [...args], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    throw new Error(`pnpm ${args.join(' ')} failed:\n${stdout}\n${stderr}`, { cause: error });
  }
}

/**
 * Builds the CLI and the plugin with their dependencies (Turborepo, cached). The plugin
 * build ends with its bundle size check (D-04), so a plugin over budget fails the smoke.
 */
export async function buildForSmoke(): Promise<void> {
  await pnpm([
    'exec',
    'turbo',
    'run',
    'build',
    '--filter=@holotype/cli...',
    '--filter=@holotype/plugin...',
    '--output-logs=errors-only',
  ]);
}

/** `pnpm -F @holotype/plugin run pack`: `packages/plugin/dist/holotype-plugin-<version>.zip`. */
export async function packPlugin(): Promise<void> {
  await pnpm(['-F', '@holotype/plugin', 'run', 'pack']);
}
