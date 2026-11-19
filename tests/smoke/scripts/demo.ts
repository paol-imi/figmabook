/**
 * `pnpm -F @holotype/smoke run demo`: the files demo D1 sends to the user (BUILD B-15),
 * in `tests/smoke/dist/`:
 *   holotype-plugin-<version>.zip  the development plugin (manifest.json + build/)
 *   smoke.holotype.zip             micro-flex--row and components-badge--default
 * Runs under Node type stripping: no TypeScript-only runtime syntax here.
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureStorybook, holotype } from '../../../packages/cli/test/e2e/support.ts';
import { buildForSmoke, DIST, packPlugin, ROOT, SMOKE_EPOCH, SMOKE_STORIES } from './build.ts';

await buildForSmoke();
await packPlugin();
await mkdir(DIST, { recursive: true });

const { version } = JSON.parse(await readFile(join(ROOT, 'packages/plugin/package.json'), 'utf8')) as {
  version: string;
};
const pluginZip = join(DIST, `holotype-plugin-${version}.zip`);
await copyFile(join(ROOT, `packages/plugin/dist/holotype-plugin-${version}.zip`), pluginZip);

const storybook = await fixtureStorybook();
try {
  const bundle = join(DIST, 'smoke.holotype.zip');
  const result = await holotype(
    ['capture', '--storybook', storybook.dir, '--story', SMOKE_STORIES.join(','), '--out', bundle],
    { cwd: DIST, env: { SOURCE_DATE_EPOCH: SMOKE_EPOCH } },
  );
  process.stdout.write(result.stdout);
  if (result.code !== 0) {
    process.stderr.write(result.stderr);
    process.exitCode = result.code;
  } else {
    console.log(`\nDemo D1 files:\n  ${pluginZip}\n  ${bundle}`);
  }
} finally {
  await storybook.close();
}
