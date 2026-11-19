import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFakeFigma, type FakeFigma } from '@holotype/figma-fake';
import { SUPPORTED_SCENE_MAJORS, sha256Hex } from '@holotype/ir';
import { compareSeverity } from '@holotype/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FixtureBuild, fixtureStorybook, holotype } from '../../../packages/cli/test/e2e/support.ts';
import { runImportSession } from '../../../packages/plugin/src/apply/session.ts';
import {
  createMainChannel,
  createUiChannel,
  figmaUiTransport,
  windowTransport,
} from '../../../packages/plugin/src/channel.ts';
import { startHost } from '../../../packages/plugin/src/host.ts';
import type { MainToUi } from '../../../packages/plugin/src/protocol.ts';
import { readBundle } from '../../../packages/plugin/src/ui/import/bundle.ts';
import { serveBundle } from '../../../packages/plugin/src/ui/import/serve.ts';
import { createFigmaUiPair } from '../../../packages/plugin/test/fixtures.ts';
import { DIST, SMOKE_EPOCH, SMOKE_STORIES } from '../scripts/build.ts';

/*
 * B-15, demo D1 (container part): `holotype capture` writes `smoke.holotype.zip` from the
 * fixture Storybook; the plugin's UI import code reads and checks it, and its main-thread
 * import session applies it to figma-fake over the real UI ↔ main protocol. The fake's
 * document and operation log must match the committed snapshot.
 */

const BUNDLE = join(DIST, 'smoke.holotype.zip');
const SESSION = 'smoke-session';

let storybook: FixtureBuild;

beforeAll(async () => {
  storybook = await fixtureStorybook();
  await mkdir(DIST, { recursive: true });
});

afterAll(async () => {
  await storybook?.close();
});

/** Imports a bundle file the way the plugin does: UI reads it, main pulls and applies it. */
async function importInPlugin(fileName: string, zip: Uint8Array, figma: FakeFigma) {
  const read = await readBundle(fileName, zip);
  if (!read.ok) throw new Error(`the plugin refused the bundle: ${read.error.code} ${JSON.stringify(read.error.data)}`);
  const { figmaUi, window } = createFigmaUiPair();
  const main = createMainChannel(figmaUiTransport(figmaUi));
  const ui = createUiChannel(windowTransport(window), SESSION);
  const received: MainToUi[] = [];
  for (const t of ['progress', 'diagnostics', 'done', 'error'] as const) ui.on(t, (message) => received.push(message));
  startHost({
    channel: main,
    pluginVersion: '0.0.0',
    irMajors: SUPPORTED_SCENE_MAJORS,
    fileKey: () => null,
    openSession: async (message, host) => {
      await runImportSession({
        message,
        host,
        channel: main,
        port: figma,
        now: () => 0,
        yieldToEditor: () => host.uiRoundTrip(),
        createId: () => 'smoke-apply',
      });
    },
  });
  ui.on('ping', ({ id }) => ui.send({ t: 'pong', id }));
  serveBundle(ui, read.value);
  ui.send({ t: 'hello', uiVersion: '0.0.0' });
  const outcome = Promise.race([ui.next('done'), ui.next('error')]);
  ui.send({ t: 'session.open', manifest: read.value.manifest, source: 'file', options: {} });
  return { bundle: read.value, outcome: await outcome, received };
}

describe('L0 smoke: CLI → bundle → plugin (demo D1)', () => {
  it('captures the two stories into smoke.holotype.zip', async () => {
    const result = await holotype(
      ['capture', '--storybook', storybook.dir, ...SMOKE_STORIES.flatMap((id) => ['--story', id]), '--out', BUNDLE],
      { cwd: DIST, env: { SOURCE_DATE_EPOCH: SMOKE_EPOCH } },
    );
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('  ✔ micro-flex        1 variant');
    expect(result.stdout).toContain('  ✔ components-badge  1 variant');
  });

  it('imports the bundle into figma-fake as frames and text', async () => {
    const zip = new Uint8Array(await readFile(BUNDLE));
    const figma = createFakeFigma({ pages: ['Page 1'] });
    const { bundle, outcome, received } = await importInPlugin('smoke.holotype.zip', zip, figma);

    expect(bundle.totals).toEqual({ components: 2, variants: 2 });
    expect(outcome).toMatchObject({
      t: 'done',
      summary: { componentsOk: 2, componentsFailed: 0, variants: 2, cancelled: false },
    });
    const diagnostics = received.flatMap((message) => (message.t === 'diagnostics' ? message.items : []));
    expect(diagnostics.filter((item) => compareSeverity(item.severity, 'error') >= 0)).toEqual([]);
    expect(figma.notifications()).toEqual(['Imported 2 components (2 variants).']);

    // What the user checks by eye in D1: a row of three boxes and a badge.
    const page = figma.root.children.find((node) => node.name === 'Components');
    if (page === undefined) throw new Error('no Components page');
    const flex = page.findOne((node) => node.name === 'Flex');
    const badge = page.findOne((node) => node.name === 'Badge' && node.type !== 'TEXT');
    expect(flex && 'children' in flex ? flex.children.map((child) => child.type) : []).toEqual([
      'FRAME',
      'FRAME',
      'FRAME',
    ]);
    const label = badge && 'findOne' in badge ? badge.findOne((node) => node.type === 'TEXT') : null;
    expect(label?.type === 'TEXT' ? label.characters : undefined).toBe('Badge');

    await expect(
      `${JSON.stringify({ tree: figma.snapshot(), ops: figma.ops(), notifications: figma.notifications() }, null, 2)}\n`,
    ).toMatchFileSnapshot('__snapshots__/d1.fake.json');
  });

  it('writes the same bundle bytes on every run', async () => {
    const again = join(DIST, 'smoke-again.holotype.zip');
    const result = await holotype(
      ['capture', '--storybook', storybook.dir, '--story', SMOKE_STORIES.join(','), '--out', again],
      { cwd: DIST, env: { SOURCE_DATE_EPOCH: SMOKE_EPOCH } },
    );
    expect(result.code).toBe(0);
    const [a, b] = await Promise.all([readFile(BUNDLE), readFile(again)]);
    expect(sha256Hex(new Uint8Array(b))).toBe(sha256Hex(new Uint8Array(a)));
  });
});
