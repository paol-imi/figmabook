/*
 * The Playwright backend of the pool (05 §1.1, §1.3): one pinned Chromium, one browser
 * context per worker with the D-24 options, the frozen clock, the seeded `Math.random` and
 * the serializer injected before any page code.
 */
import type { ConnectedStorybook, RenderDriver } from '@holotype/storybook';
import { type Browser, type BrowserContext, chromium, type LaunchOptions, type Page } from 'playwright';
import {
  type CaptureEnvironment,
  CHROMIUM_ARGS,
  captureUserAgent,
  contextOptions,
  seededRandomScript,
} from '../environment';
import type { ContextLike, SessionLike, WorkerBackend } from './worker';

/** A worker's page and its render driver. */
export interface CaptureSession extends SessionLike {
  readonly page: Page;
  readonly driver: RenderDriver;
}

export interface ChromiumBackendOptions {
  readonly env: CaptureEnvironment;
  readonly storybook: Pick<ConnectedStorybook, 'openDriver'>;
  /** The in-page serializer IIFE (`serializerSource`). */
  readonly serializer: string;
  readonly engineVersion: string;
  /** A Chromium binary; default is Playwright's `chromium` channel (new headless, 05 §1.3). */
  readonly chromiumPath?: string;
  readonly launch?: LaunchOptions;
  readonly renderTimeoutMs?: number;
  /** Called for each new page before its driver opens: routes, auth headers (03 §9.4). */
  readonly preparePage?: (page: Page) => void | Promise<void>;
}

export interface BrowserInfo {
  /** Chromium version, e.g. `141.0.7390.37`. */
  readonly version: string;
}

export class ChromiumBackend implements WorkerBackend<CaptureSession> {
  private browser: Promise<{ browser: Browser; userAgent: string }> | undefined;
  private closed = false;

  constructor(private readonly options: ChromiumBackendOptions) {}

  /** Launches the browser if needed and reports its version. */
  async info(): Promise<BrowserInfo> {
    const { browser } = await this.ensureBrowser();
    return { version: browser.version() };
  }

  async openContext(): Promise<ContextLike<CaptureSession>> {
    const { browser, userAgent } = await this.ensureBrowser();
    const { env, serializer } = this.options;
    const context = await browser.newContext(contextOptions(env, userAgent));
    // Date is frozen; timers and requestAnimationFrame stay real (05 §1.1).
    if (env.clock !== false) await context.clock.setFixedTime(new Date(env.clock));
    if (env.seededRandom) await context.addInitScript({ content: seededRandomScript() });
    await context.addInitScript({ content: serializer });
    return {
      openSession: () => this.openSession(browser, context),
      close: () => context.close().catch(() => undefined),
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    const launched = this.browser;
    this.browser = undefined;
    if (launched === undefined) return;
    const { browser } = await launched.catch(() => ({ browser: undefined }));
    await browser?.close().catch(() => undefined);
  }

  private async openSession(browser: Browser, context: BrowserContext): Promise<CaptureSession> {
    const page = await context.newPage();
    let crashed = false;
    page.on('crash', () => {
      crashed = true;
    });
    await this.options.preparePage?.(page);
    const driverOptions =
      this.options.renderTimeoutMs === undefined ? {} : { renderTimeoutMs: this.options.renderTimeoutMs };
    const driver = await this.options.storybook.openDriver(page, driverOptions);
    return {
      page,
      driver,
      get broken() {
        return crashed || page.isClosed() || !browser.isConnected();
      },
      close: async () => {
        await driver.dispose();
        if (!page.isClosed()) await page.close().catch(() => undefined);
      },
    };
  }

  /** The running browser; relaunched when it went away (05 §1.1: a disconnect restarts the pool). */
  private ensureBrowser(): Promise<{ browser: Browser; userAgent: string }> {
    if (this.closed) return Promise.reject(new Error('The capture browser is closed.'));
    this.browser ??= this.launch();
    return this.browser.then(
      (launched) => {
        if (launched.browser.isConnected()) return launched;
        this.browser = undefined;
        return this.ensureBrowser();
      },
      (error: unknown) => {
        this.browser = undefined;
        throw error;
      },
    );
  }

  private async launch(): Promise<{ browser: Browser; userAgent: string }> {
    const { chromiumPath, launch = {}, engineVersion } = this.options;
    const browser = await chromium.launch({
      ...launch,
      ...(chromiumPath === undefined ? { channel: launch.channel ?? 'chromium' } : { executablePath: chromiumPath }),
      args: [...CHROMIUM_ARGS, ...(launch.args ?? [])],
    });
    const cdp = await browser.newBrowserCDPSession();
    const { userAgent } = await cdp.send('Browser.getVersion');
    await cdp.detach();
    return { browser, userAgent: captureUserAgent(userAgent, engineVersion) };
  }
}
