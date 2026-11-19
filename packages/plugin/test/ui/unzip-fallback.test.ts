import { describe, expect, it, vi } from 'vitest';
import { fflateUnzip } from '../../src/ui/import/unzip';
import { bundleOf, zipOf } from '../support/scenes';

const mode = vi.hoisted(() => ({ current: 'throw' as 'throw' | 'callback' }));

// The null-origin iframe may refuse to start fflate's Web Workers (verify, S-06).
vi.mock('fflate', async (importOriginal) => {
  const fflate = await importOriginal<typeof import('fflate')>();
  return {
    ...fflate,
    unzip: (_bytes: Uint8Array, _options: unknown, callback: (error: Error | null, files: null) => void) => {
      if (mode.current === 'throw') throw new Error('Worker is not defined');
      callback(new Error('worker failed'), null);
      return () => {};
    },
  };
});

describe('fflateUnzip without Web Workers', () => {
  const zip = zipOf(bundleOf().files);

  it.each(['throw', 'callback'] as const)('inflates on the UI thread when the worker path fails (%s)', async (how) => {
    mode.current = how;
    const files = await fflateUnzip(zip, () => true);
    expect(Object.keys(files)).toContain('manifest.json');
  });

  it('rejects data that is not a zip', async () => {
    await expect(fflateUnzip(new Uint8Array([1, 2, 3]), () => true)).rejects.toThrow();
  });
});
