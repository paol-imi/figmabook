import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));

/** Builds the CLI and everything it imports, so the e2e suite runs the real `holotype` binary. */
export default async function setup(): Promise<void> {
  try {
    await run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@holotype/cli...', '--output-logs=errors-only'], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    throw new Error(`Building the CLI failed:\n${stdout}\n${stderr}`, { cause: error });
  }
}
