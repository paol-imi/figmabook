/**
 * S-19 on the real ds-react dev server: every captured component field resolves to a verified
 * location or to an explicit reason, with no wrong file; without CSS source maps the run degrades
 * to `approximate` locations and `DCR_PROVENANCE_NO_SOURCEMAP`.
 */
import { unwrap } from '@holotype/shared';
import { type ConnectedStorybook, connectStorybook } from '@holotype/storybook';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarize } from '../coverage.ts';
import { type DevServer, REPO_ROOT, startDevServer } from '../dev-server.ts';
import { runSpike, type SpikeRun } from '../spike.ts';

const chromiumPath = process.env.HOLOTYPE_CHROMIUM_PATH;
const chromium = chromiumPath === undefined || chromiumPath === '' ? {} : { chromiumPath };
const STORIES = [
  'components-badge--with-dot',
  'components-button--primary',
  'components-button--secondary',
  'components-card--default',
  'components-input--with-error',
  'components-stack--row',
];

async function measure(sourcemaps: boolean): Promise<{ run: SpikeRun; close: () => Promise<void> }> {
  const server: DevServer = await startDevServer({ sourcemaps });
  let storybook: ConnectedStorybook | undefined;
  try {
    storybook = unwrap(await connectStorybook({ source: server.url }));
    const themes = sourcemaps ? (['light', 'dark'] as const) : (['light'] as const);
    const run = await runSpike({ storybook, storyIds: STORIES, themes, repoRoot: REPO_ROOT, ...chromium });
    return {
      run,
      close: async () => {
        await storybook?.close();
        await server.close();
      },
    };
  } catch (error) {
    await storybook?.close();
    await server.close();
    throw error;
  }
}

describe('S-19 on the dev server with css.devSourcemap', () => {
  let result: Awaited<ReturnType<typeof measure>>;
  beforeAll(async () => {
    result = await measure(true);
  }, 240_000);
  afterAll(() => result?.close());

  it('captures and locates every node', () => {
    expect(result.run.captureFailures).toEqual([]);
    expect(result.run.unmatched).toEqual([]);
    expect(result.run.diagnostics).toEqual([]);
  });

  it('resolves Button padding and fill to the CSS module and the token definitions', () => {
    const fields = result.run.records.filter(
      (r) => r.storyId === 'components-button--primary' && r.path === 'button:0',
    );
    const padding = fields.find((r) => r.field.property === 'padding-left')?.field;
    expect(padding).toMatchObject({
      status: 'resolved',
      selector: { original: '.md' },
      rule: { file: 'fixtures/ds-react/src/components/Button/Button.module.css', line: 67, col: 3 },
      varChain: { names: ['--space-4'], definitions: [{ loc: { file: 'fixtures/ds-react/src/tokens/tokens.css' } }] },
    });
    const fill = fields.find((r) => r.field.property === 'background-color')?.field;
    expect(fill?.varChain?.names).toEqual(['--button-bg', '--color-primary', '--color-blue-600']);
  });

  it('resolves a dark-theme token through the [data-theme="dark"] scope', () => {
    const fill = result.run.records.find(
      (r) =>
        r.storyId === 'components-button--primary' && r.theme === 'dark' && r.field.property === 'background-color',
    )?.field;
    expect(fill?.varChain?.names).toEqual(['--button-bg', '--color-primary', '--color-blue-500']);
    expect(fill?.varChain?.definitions.map((d) => d.selector?.original)).toEqual([
      ':root',
      '[data-theme="dark"]',
      ':root',
    ]);
    expect(fill?.valueCheck).toBe('match');
  });

  it('has no wrong file, wrong selector or unexplained value, and resolves every author-declared field', () => {
    const [all] = summarize(result.run.records, () => 'all');
    expect(all).toMatchObject({ wrongFile: 0, wrongSelector: 0, valueMismatch: 0, approximateOk: 0, selectorOnly: 0 });
    const reasons = new Set(
      result.run.records.filter((r) => r.field.status === 'unresolved').map((r) => r.field.reason),
    );
    // The only unresolved fields are browser defaults and initial values: nothing to point at.
    expect([...reasons].filter((r) => r !== 'user-agent' && r !== 'not-declared')).toEqual([]);
    expect(all?.chainComplete).toBe(all?.withVar);
  });
});

describe('S-19 on the dev server without CSS source maps', () => {
  let result: Awaited<ReturnType<typeof measure>>;
  beforeAll(async () => {
    result = await measure(false);
  }, 240_000);
  afterAll(() => result?.close());

  it('falls back to data-vite-dev-id with served lines and warns once per file', () => {
    const [all] = summarize(result.run.records, () => 'all');
    expect(all).toMatchObject({ resolved: 0, approximateWrong: 0, wrongFile: 0 });
    expect(all?.approximateOk).toBeGreaterThan(0);
    const codes = new Set(result.run.diagnostics.map((d) => d.code));
    expect([...codes]).toEqual(['DCR_PROVENANCE_NO_SOURCEMAP']);
    const files = result.run.diagnostics.map((d) => d.data?.file);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toContain('fixtures/ds-react/src/components/Button/Button.module.css');
  });
});
