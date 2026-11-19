import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonValue } from '@holotype/ir';
import { unwrap } from '@holotype/shared';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStorybook } from '../../../../fixtures/ds-react/test/support/storybook.ts';
import { type ConnectedStorybook, connectStorybook, type SbError, type StoryMeta } from '../../src';
import { buildFixtureWithManifest, launchBrowser, loopbackContext } from './support';

/**
 * B-40 e2e: `describe()` (03 §4) on `fixtures/ds-react`, built twice: as the fixture is, and with
 * the SB 10 components manifest on. One snapshot per component.
 */

let tempDir: string;
let plain: ConnectedStorybook;
let withManifest: ConnectedStorybook;
let browser: Browser;
let context: BrowserContext;
const outside: string[] = [];

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'holotype-sb-describe-e2e-'));
  // Same folder name for both builds: they get the same document origin, `static:storybook-static`.
  const plainDir = join(tempDir, 'plain', 'storybook-static');
  const manifestDir = join(tempDir, 'manifest', 'storybook-static');
  await Promise.all([buildStorybook(plainDir), buildFixtureWithManifest(manifestDir)]);
  plain = unwrap(await connectStorybook({ source: { kind: 'static', dir: plainDir } }));
  withManifest = unwrap(await connectStorybook({ source: { kind: 'static', dir: manifestDir } }));
  browser = await launchBrowser();
  context = await loopbackContext(browser, outside);
});

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await plain?.close();
  await withManifest?.close();
  if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
});

function expectMeta(result: StoryMeta | SbError | undefined): StoryMeta {
  if (result === undefined || !('sid' in result)) throw new Error(`no metadata: ${JSON.stringify(result)}`);
  return result;
}

/** The snapshot form: `parameters.docs` holds Storybook's own (minified) functions, not the project's. */
function snapshotOf(meta: StoryMeta): unknown {
  const { docs: _docs, ...parameters } = meta.parameters as Record<string, JsonValue>;
  return { ...meta, parameters };
}

describe('describe()', () => {
  it('reads every story of every ds-react component, with the manifest CodeRef (snapshot per component)', async () => {
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    try {
      const stories = await withManifest.listStories();
      const started = Date.now();
      const result = await withManifest.describe(
        page,
        stories.map((story) => story.id),
      );
      const ms = Date.now() - started;
      expect(result.diagnostics).toEqual([]);
      expect(result.stories.size).toBe(stories.length);
      expect(ms).toBeLessThan(10_000);
      // The preview boots without a story id: nothing renders, nothing is logged (S-07 Q13).
      expect(consoleErrors).toEqual([]);
      const bySid = new Map<string, unknown[]>();
      for (const story of stories) {
        const meta = expectMeta(result.stories.get(story.id));
        expect(meta.diagnostics).toEqual([]);
        bySid.set(meta.sid, [...(bySid.get(meta.sid) ?? []), snapshotOf(meta)]);
      }
      expect([...bySid.keys()]).toHaveLength(10);
      for (const [sid, metas] of bySid) {
        await expect(`${JSON.stringify(metas, null, 2)}\n`).toMatchFileSnapshot(`__snapshots__/describe/${sid}.json`);
      }
    } finally {
      await page.close();
    }
  });

  it('describes the same stories without the manifest, export names from docgen', async () => {
    const page = await context.newPage();
    try {
      const ids = ['components-button--primary', 'components-card--with-media', 'micro-flex--row'];
      const [without, withIt] = [await plain.describe(page, ids), await withManifest.describe(page, ids)];
      for (const id of ids) {
        const a = expectMeta(without.stories.get(id));
        const b = expectMeta(withIt.stories.get(id));
        const { package: _package, ...code } = b.code;
        expect(a.code).toEqual(code);
        expect(a.argTypes).toEqual(b.argTypes);
        expect(a.holotype).toEqual(b.holotype);
      }
      expect(expectMeta(without.stories.get('components-button--primary')).code.exportName).toBe('Button');
      // Asset URLs name the portable origin, not the ephemeral port (F-01).
      const media = expectMeta(without.stories.get('components-card--with-media')).argTypes.media?.mapping;
      expect(media?.Landscape).toMatch(/^static:storybook-static\/assets\/landscape-[\w-]+\.png$/);
    } finally {
      await page.close();
    }
  });

  it('applies config layers and reports unknown ids and broken CSF files per story', async () => {
    const page = await context.newPage();
    await page.route('**/assets/Badge.stories-*.js', (route) => route.abort('failed'));
    try {
      const result = await plain.describe(
        page,
        ['components-button--primary', 'components-button--nope', 'components-badge--default'],
        { defaults: { matrix: 'pairwise' }, components: { 'components-*': { delay: 50 } }, batchSize: 1 },
      );
      expect([...result.stories.keys()]).toEqual([
        'components-button--primary',
        'components-button--nope',
        'components-badge--default',
      ]);
      expect(expectMeta(result.stories.get('components-button--primary')).holotype).toMatchObject({
        matrix: 'pairwise',
        delay: 50,
        grid: { columns: ['Size'], rows: ['Variant'] },
      });
      expect(result.stories.get('components-button--nope')).toMatchObject({ ok: false, code: 'SB_STORY_MISSING' });
      expect(result.stories.get('components-badge--default')).toMatchObject({
        ok: false,
        code: 'SB_STORY_LOAD_FAILED',
      });
    } finally {
      await page.close();
    }
  });

  it('gives a batch that hangs SB_METADATA_TIMEOUT, after a retry on a fresh page', async () => {
    const page = await context.newPage();
    await page.route('**/assets/Card.stories-*.js', () => {});
    try {
      const result = await plain.describe(page, ['components-card--default', 'components-badge--default'], {
        batchSize: 1,
        batchTimeoutMs: 800,
      });
      expect(result.stories.get('components-card--default')).toMatchObject({
        code: 'SB_METADATA_TIMEOUT',
        diagnostic: { data: { storyId: 'components-card--default', timeoutMs: 800 } },
      });
      expect(expectMeta(result.stories.get('components-badge--default')).sid).toBe('components-badge');
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.close();
    }
  });

  it('made no request outside 127.0.0.1', () => {
    expect(outside).toEqual([]);
  });
});
