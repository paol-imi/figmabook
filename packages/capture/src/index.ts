import type { CaptureDoc } from '@holotype/ir';
import { NotImplementedError } from '@holotype/shared';
import type { BrowserContextOptions, LaunchOptions } from 'playwright';

export type { PageSerializer } from './page/serializer';
export { serializerSource } from './serializer-source';

/**
 * The default capture environment (D-24). The Chromium version is part of the capture
 * cache key, so the browser is pinned per release (D-05).
 */
export const CAPTURE_ENVIRONMENT = Object.freeze({
  context: {
    deviceScaleFactor: 2,
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  } satisfies BrowserContextOptions,
  /** Appended to the user agent so Storybook snaps animations. */
  userAgentSuffix: 'StorybookTestRunner',
  /** `page.clock` is pinned here; `Math.random` is seeded by an init script. */
  clock: '2026-01-01T00:00:00Z',
  chromiumArgs: ['--font-render-hinting=none'],
});

export interface CapturerOptions {
  /** A preinstalled Chromium. Fidelity is only guaranteed with the pinned version. */
  readonly chromiumPath?: string;
  readonly launch?: LaunchOptions;
}

/** One variant to capture. */
export interface CaptureRequest {
  readonly storybookUrl: string;
  readonly storyId: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly globals?: Readonly<Record<string, unknown>>;
  readonly rootSelector?: string;
}

export interface Capturer {
  capture(request: CaptureRequest): Promise<CaptureDoc>;
  close(): Promise<void>;
}

/** Creates a capturer backed by a pooled, pinned Chromium (05). */
export function createCapturer(_options: CapturerOptions = {}): Capturer {
  return {
    capture: async () => {
      throw new NotImplementedError('Capturer.capture', 'Phase 1');
    },
    close: async () => {},
  };
}
