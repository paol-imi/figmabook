import { execFile } from 'node:child_process';
import { appendFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { type Browser, type BrowserContext, chromium, type LaunchOptions, type Page } from 'playwright';
import { packageRoot as fixtureRoot } from '../../../../fixtures/ds-react/test/support/storybook.ts';
import type { RenderDriver, RenderResult, SbError } from '../../src';

/** Chromium for the e2e suites: `HOLOTYPE_CHROMIUM_PATH` when set. */
export function launchBrowser(): Promise<Browser> {
  const launch: LaunchOptions = {};
  const executablePath = process.env.HOLOTYPE_CHROMIUM_PATH;
  if (executablePath !== undefined && executablePath !== '') launch.executablePath = executablePath;
  return chromium.launch(launch);
}

/** The test-runner user agent the capture contexts use (D-24). */
export const TEST_RUNNER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 StorybookTestRunner holotype/e2e';

/** A context with the D-24 viewport; requests outside 127.0.0.1 are aborted and recorded (BUILD §3.1 rule 8). */
export async function loopbackContext(
  browser: Browser,
  outside: string[],
  userAgent: string = TEST_RUNNER_AGENT,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    userAgent,
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.hostname === '127.0.0.1') {
      await route.fallback();
    } else {
      outside.push(url.href);
      await route.abort('blockedbyclient');
    }
  });
  return context;
}

/** Disposes a driver and closes its page, each within `ms`: a stuck page fails the test, never the hook. */
export async function closeBounded(driver: RenderDriver | undefined, page: Page | undefined, ms = 10_000) {
  const bounded = (work: Promise<unknown>, what: string) =>
    Promise.race([
      work,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took more than ${ms} ms`)), ms)),
    ]);
  if (driver !== undefined) await bounded(driver.dispose(), 'driver.dispose()');
  if (page !== undefined && !page.isClosed()) await bounded(page.close(), 'page.close()');
}

export function expectOk(result: RenderResult | SbError): RenderResult {
  if (!result.ok) throw new Error(`render failed: ${result.code} ${JSON.stringify(result.diagnostic)}`);
  return result;
}

export function expectError(result: RenderResult | SbError): SbError {
  if (result.ok) throw new Error(`expected a failed render of ${result.storyId}`);
  return result;
}

/** The channel document id of the page (changes with every document). */
export const docIdOf = (page: Page): Promise<string | null> =>
  page.evaluate(
    () => (window as unknown as { __holotypeSbChannel?: { docId: string } }).__holotypeSbChannel?.docId ?? null,
  );

const run = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * Builds `fixtures/ds-react` with the SB 10 components manifest on (`features.componentsManifest`),
 * from a copy of its `.storybook` config under the fixture's `node_modules` (git-ignored); the
 * fixture's own config stays as it is.
 */
export async function buildFixtureWithManifest(outputDir: string): Promise<void> {
  const configDir = join(fixtureRoot, 'node_modules', '.holotype-e2e-manifest-config');
  await rm(configDir, { recursive: true, force: true });
  await mkdir(configDir, { recursive: true });
  try {
    await cp(join(fixtureRoot, '.storybook'), configDir, { recursive: true });
    const main = await readFile(join(configDir, 'main.ts'), 'utf8');
    const withManifest = main
      .replace("'../src/**/*.stories.@(ts|tsx)'", "'../../src/**/*.stories.@(ts|tsx)'")
      .replace('addons: [],', 'addons: [],\n  features: { componentsManifest: true },');
    if (!withManifest.includes('componentsManifest') || !withManifest.includes('../../src/')) {
      throw new Error('The fixture main.ts changed shape: update buildFixtureWithManifest.');
    }
    await writeFile(join(configDir, 'main.ts'), withManifest);
    const preview = await readFile(join(configDir, 'preview.tsx'), 'utf8');
    await writeFile(join(configDir, 'preview.tsx'), preview.replaceAll("'../src/", "'../../src/"));
    const manifest = require.resolve('storybook/package.json', { paths: [fixtureRoot] });
    const { bin } = JSON.parse(await readFile(manifest, 'utf8')) as { bin: string | Record<string, string> };
    const binPath = typeof bin === 'string' ? bin : (bin.storybook ?? '');
    await run(
      process.execPath,
      [join(dirname(manifest), binPath), 'build', '-c', configDir, '--output-dir', outputDir, '--quiet'],
      {
        cwd: fixtureRoot,
        env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1', NO_COLOR: '1', CI: 'true' },
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}

/** Appends a measurement line to `HOLOTYPE_E2E_METRICS` when it names a file (throughput reports). */
export async function recordMetric(line: string): Promise<void> {
  const file = process.env.HOLOTYPE_E2E_METRICS;
  if (file !== undefined && file !== '') await appendFile(file, `${new Date().toISOString()} ${line}\n`);
}
