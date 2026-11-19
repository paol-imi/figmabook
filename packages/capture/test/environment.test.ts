import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  CHROMIUM_ARGS,
  captureUserAgent,
  contextOptions,
  currentHost,
  DEFAULT_ENVIRONMENT,
  RANDOM_SEED,
  resolveEnvironment,
  resolveWorkerCount,
  seededRandomScript,
} from '../src';

function randomsOf(script: string, count: number): number[] {
  const sandbox = { Math: Object.create(Math) as Math };
  runInNewContext(script, sandbox);
  return Array.from({ length: count }, () => sandbox.Math.random());
}

describe('capture environment (D-24)', () => {
  it('defaults to the D-24 context', () => {
    expect(resolveEnvironment()).toEqual(DEFAULT_ENVIRONMENT);
    expect(DEFAULT_ENVIRONMENT).toEqual({
      viewport: { width: 1280, height: 800 },
      dpr: 2,
      locale: 'en-US',
      timezone: 'UTC',
      colorScheme: 'light',
      clock: '2026-01-01T00:00:00Z',
      animations: 'finish',
      seededRandom: true,
    });
  });

  it('applies the capture config (16 §7)', () => {
    expect(
      resolveEnvironment({
        dpr: 1,
        locale: 'de-DE',
        timezone: 'Europe/Berlin',
        clock: false,
        animations: 'pause-only',
        determinism: { random: false },
        workers: 3,
      }),
    ).toMatchObject({
      dpr: 1,
      locale: 'de-DE',
      timezone: 'Europe/Berlin',
      clock: false,
      animations: 'pause-only',
      seededRandom: false,
    });
    expect(() => resolveEnvironment({ clock: 'yesterday' })).toThrow(/capture\.clock/);
  });

  it('builds the browser context options', () => {
    expect(contextOptions(DEFAULT_ENVIRONMENT, 'UA')).toEqual({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
      userAgent: 'UA',
      serviceWorkers: 'block',
      bypassCSP: false,
      javaScriptEnabled: true,
    });
  });

  it('marks the user agent for the Storybook test runner and Holotype', () => {
    expect(captureUserAgent('Mozilla/5.0 HeadlessChrome/153.0.0.0', '1.2.3')).toBe(
      'Mozilla/5.0 HeadlessChrome/153.0.0.0 StorybookTestRunner holotype/1.2.3',
    );
  });

  it('launches Chromium with the 05 §1.3 flags', () => {
    expect(CHROMIUM_ARGS).toEqual([
      '--font-render-hinting=none',
      '--disable-lcd-text',
      '--force-color-profile=srgb',
      '--hide-scrollbars',
      '--disable-features=PaintHolding',
    ]);
  });
});

describe('seededRandomScript', () => {
  it('replaces Math.random with a deterministic generator in [0, 1)', () => {
    const first = randomsOf(seededRandomScript(), 1000);
    expect(randomsOf(seededRandomScript(RANDOM_SEED), 1000)).toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(first).size).toBe(1000);
    const mean = first.reduce((sum, value) => sum + value, 0) / first.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('gives a different sequence for a different seed and rejects non-integers', () => {
    expect(randomsOf(seededRandomScript(1), 3)).not.toEqual(randomsOf(seededRandomScript(2), 3));
    expect(() => seededRandomScript(1.5)).toThrow(RangeError);
  });
});

describe('resolveWorkerCount (05 §1.1)', () => {
  it('uses min(8, max(1, parallelism − 1)) locally', () => {
    expect(resolveWorkerCount('auto', { ci: false, parallelism: 16, cpus: 16 })).toBe(8);
    expect(resolveWorkerCount('auto', { ci: false, parallelism: 4, cpus: 4 })).toBe(3);
    expect(resolveWorkerCount('auto', { ci: false, parallelism: 1, cpus: 1 })).toBe(1);
  });

  it('uses min(4, cpus) in CI', () => {
    expect(resolveWorkerCount('auto', { ci: true, parallelism: 16, cpus: 16 })).toBe(4);
    expect(resolveWorkerCount('auto', { ci: true, parallelism: 2, cpus: 2 })).toBe(2);
  });

  it('reads CI from the environment', () => {
    expect(currentHost({ CI: 'true' }).ci).toBe(true);
    expect(currentHost({ CI: '1' }).ci).toBe(true);
    expect(currentHost({ CI: 'false' }).ci).toBe(false);
    expect(currentHost({ CI: '0' }).ci).toBe(false);
    expect(currentHost({}).ci).toBe(false);
    expect(currentHost({}).parallelism).toBeGreaterThanOrEqual(1);
  });

  it('takes an explicit count (`--concurrency`) and rejects bad ones', () => {
    expect(resolveWorkerCount(3, { ci: true, parallelism: 1, cpus: 1 })).toBe(3);
    expect(() => resolveWorkerCount(0)).toThrow(RangeError);
    expect(() => resolveWorkerCount(1.5)).toThrow(RangeError);
  });
});
