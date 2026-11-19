/*
 * The deterministic capture environment (D-24, 05 §1.1, §1.3, §10.1; config 16 §7): context
 * options, Chromium flags, the frozen clock and the seeded `Math.random`.
 */
import type { HolotypeConfig } from '@holotype/ir';
import type { BrowserContextOptions } from 'playwright';

/** Chromium flags (05 §1.3). GPU stays default: rasterization does not change DOM geometry. */
export const CHROMIUM_ARGS: readonly string[] = Object.freeze([
  // Advances closer to Figma's unhinted layout (verify, S-04).
  '--font-render-hinting=none',
  '--disable-lcd-text',
  // Comparable screenshots.
  '--force-color-profile=srgb',
  '--hide-scrollbars',
  '--disable-features=PaintHolding',
]);

/** Appended to the user agent: Storybook pauses CSS animations for its test runner (03 §5.5). */
export const STORYBOOK_TEST_RUNNER_UA = 'StorybookTestRunner';

/** Seed of the page's `Math.random` (05 §1.1). */
export const RANDOM_SEED = 0xf16b00c;

/** The `capture` namespace of `holotype.config.ts` (16 §7). */
export type CaptureConfig = NonNullable<HolotypeConfig['capture']>;

/** The resolved environment of a capturer. Every field but `workers` is part of the cache key (16 §7). */
export interface CaptureEnvironment {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly dpr: 1 | 2 | 3;
  readonly locale: string;
  readonly timezone: string;
  readonly colorScheme: 'light' | 'dark' | 'no-preference';
  /** ISO date `Date` is frozen at with `clock.setFixedTime`; `false` keeps the real clock. */
  readonly clock: string | false;
  /** `finish` finite Web Animations after render, or only pause (`pause-only`). */
  readonly animations: 'finish' | 'pause-only';
  /** Seed `Math.random` (`capture.determinism.random`). */
  readonly seededRandom: boolean;
}

/** D-24 defaults; 16 §7 lists the same values. */
export const DEFAULT_ENVIRONMENT: CaptureEnvironment = Object.freeze({
  viewport: Object.freeze({ width: 1280, height: 800 }),
  dpr: 2,
  locale: 'en-US',
  timezone: 'UTC',
  colorScheme: 'light',
  clock: '2026-01-01T00:00:00Z',
  animations: 'finish',
  seededRandom: true,
});

/** Applies the `capture` config namespace (16 §7) over the defaults. */
export function resolveEnvironment(config: CaptureConfig = {}): CaptureEnvironment {
  const clock = config.clock ?? DEFAULT_ENVIRONMENT.clock;
  if (clock !== false && Number.isNaN(Date.parse(clock))) {
    throw new RangeError(`capture.clock must be an ISO date or false, got "${clock}".`);
  }
  return {
    ...DEFAULT_ENVIRONMENT,
    dpr: config.dpr ?? DEFAULT_ENVIRONMENT.dpr,
    locale: config.locale ?? DEFAULT_ENVIRONMENT.locale,
    timezone: config.timezone ?? DEFAULT_ENVIRONMENT.timezone,
    clock,
    animations: config.animations ?? DEFAULT_ENVIRONMENT.animations,
    seededRandom: config.determinism?.random ?? DEFAULT_ENVIRONMENT.seededRandom,
  };
}

/** The capture user agent: the browser's own, plus the Storybook test-runner marker and ours. */
export function captureUserAgent(browserUserAgent: string, engineVersion: string): string {
  return `${browserUserAgent} ${STORYBOOK_TEST_RUNNER_UA} holotype/${engineVersion}`;
}

/** Browser-context options of every capture worker (05 §1.1). */
export function contextOptions(env: CaptureEnvironment, userAgent: string): BrowserContextOptions {
  return {
    viewport: { width: env.viewport.width, height: env.viewport.height },
    deviceScaleFactor: env.dpr,
    locale: env.locale,
    timezoneId: env.timezone,
    colorScheme: env.colorScheme,
    reducedMotion: 'reduce',
    userAgent,
    serviceWorkers: 'block',
    bypassCSP: false,
    javaScriptEnabled: true,
  };
}

/**
 * Init script that replaces `Math.random` with a seeded mulberry32 generator. It runs at the
 * start of every document, so each render sees the same sequence.
 */
export function seededRandomScript(seed: number = RANDOM_SEED): string {
  if (!Number.isInteger(seed)) throw new RangeError(`The Math.random seed must be an integer, got ${seed}.`);
  return `(() => {
  let state = ${seed >>> 0};
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Object.defineProperty(Math, 'random', { value: random, writable: true, configurable: true });
})();`;
}
