import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { PAGE_GLOBAL, type PageSerializer, SERIALIZER_PROTOCOL, serializerSource } from '../src';

/** Budget of the built page bundle (05 §2.1, BUILD §3.2 "Page code"). */
const MAX_BYTES = 150 * 1024;

describe('serializerSource', () => {
  it('is a self-contained IIFE that installs only the page serializer', () => {
    const sandbox: Record<string, unknown> = {};
    runInNewContext(serializerSource, sandbox);
    const api = sandbox[PAGE_GLOBAL] as PageSerializer | undefined;
    expect(api?.protocol).toBe(SERIALIZER_PROTOCOL);
    expect(typeof api?.serialize).toBe('function');
    expect(Object.isFrozen(api)).toBe(true);
    // Nothing else leaks into the page's global scope.
    expect(Object.keys(sandbox)).toEqual([]);
  });

  it(`stays within the ${MAX_BYTES / 1024} kB budget and imports nothing`, () => {
    expect(new TextEncoder().encode(serializerSource).byteLength).toBeLessThanOrEqual(MAX_BYTES);
    expect(serializerSource).not.toMatch(/\brequire\(|\bimport\s*\(|^import\s/m);
  });

  it('can be installed twice (the init script runs in every document)', () => {
    const sandbox: Record<string, unknown> = {};
    runInNewContext(serializerSource, sandbox);
    expect(() => runInNewContext(serializerSource, sandbox)).not.toThrow();
  });
});
