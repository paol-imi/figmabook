import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

const require = createRequire(import.meta.url);
const run = promisify(execFile);

/** Builds the fixture Storybook into `outputDir` with the pinned local CLI. */
export async function buildStorybook(outputDir: string): Promise<void> {
  const manifest = require.resolve('storybook/package.json', { paths: [packageRoot] });
  const { bin } = JSON.parse(await readFile(manifest, 'utf8')) as { bin: string | Record<string, string> };
  const binPath = typeof bin === 'string' ? bin : bin.storybook;
  if (binPath === undefined) throw new Error(`No "storybook" bin in ${manifest}.`);
  try {
    await run(process.execPath, [join(dirname(manifest), binPath), 'build', '--output-dir', outputDir, '--quiet'], {
      cwd: packageRoot,
      env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1', NO_COLOR: '1', CI: 'true' },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    throw new Error(`storybook build failed:\n${stdout}\n${stderr}`, { cause: error });
  }
}

/** The subset of a Storybook 10 `index.json` entry the fixture tests read. */
export interface IndexEntry {
  type: 'story' | 'docs';
  id: string;
  title: string;
  name: string;
  importPath: string;
  tags?: string[];
}

export interface StoryIndex {
  v: number;
  entries: Record<string, IndexEntry>;
}

export async function readStoryIndex(outputDir: string): Promise<StoryIndex> {
  return JSON.parse(await readFile(join(outputDir, 'index.json'), 'utf8')) as StoryIndex;
}

/** Story ids of the index, sorted, without docs entries. */
export function sortedStoryIds(index: StoryIndex): string[] {
  return Object.values(index.entries)
    .filter((entry) => entry.type === 'story')
    .map((entry) => entry.id)
    .sort();
}
