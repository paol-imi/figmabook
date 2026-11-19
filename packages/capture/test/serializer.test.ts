import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CAPTURE_ENVIRONMENT, type PageSerializer, serializerSource } from '../src';

describe('serializerSource', () => {
  it('is a self-contained IIFE that installs the page serializer', () => {
    const sandbox: { __holotype__?: PageSerializer; document?: unknown } = {};
    runInNewContext(serializerSource, sandbox);
    expect(sandbox.__holotype__?.protocol).toBe(1);
    // Nothing else leaks into the page's global scope.
    expect(Object.keys(sandbox)).toEqual([]);
  });

  it('measures the capture root with the page DOM', () => {
    const root = { getBoundingClientRect: () => ({ x: 8, y: 16, width: 120, height: 40 }) };
    const sandbox: { __holotype__?: PageSerializer; document: unknown } = {
      document: { querySelector: (selector: string) => (selector === '#storybook-root' ? root : null) },
    };
    runInNewContext(serializerSource, sandbox);
    expect(sandbox.__holotype__?.measureRoot('#storybook-root')).toEqual({ x: 8, y: 16, w: 120, h: 40 });
    expect(sandbox.__holotype__?.measureRoot('#missing')).toBeNull();
  });
});

describe('CAPTURE_ENVIRONMENT (D-24)', () => {
  it('pins the deterministic browser context', () => {
    expect(CAPTURE_ENVIRONMENT.context).toEqual({
      deviceScaleFactor: 2,
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    expect(CAPTURE_ENVIRONMENT.clock).toBe('2026-01-01T00:00:00Z');
    expect(CAPTURE_ENVIRONMENT.chromiumArgs).toContain('--font-render-hinting=none');
  });
});
