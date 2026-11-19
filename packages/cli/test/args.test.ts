import { describe, expect, it } from 'vitest';
import { captureArgs } from '../src';
import { missingValues, repeatedValues, unknownFlags } from '../src/commands/args';

describe('flag helpers', () => {
  it('collects every --story value, repeated or comma-separated', () => {
    expect(repeatedValues(['--story', 'a--x', '--json', '--story=b--y, c--z', '--story', '--out'], 'story')).toEqual([
      'a--x',
      'b--y',
      'c--z',
    ]);
    expect(repeatedValues(['--', '--story', 'a--x'], 'story')).toEqual([]);
  });

  it('finds flags the command does not declare', () => {
    expect(unknownFlags(['--story', 'a--b', '--json', '-c', 'x', '--no-json', '--help'], captureArgs)).toEqual([]);
    expect(unknownFlags(['--colour=red', '-x', '--', '--later'], captureArgs)).toEqual(['--colour', '-x']);
  });

  it('finds string flags without a value', () => {
    expect(missingValues(['--out'], captureArgs)).toEqual(['--out']);
    expect(missingValues(['--out', '--json', '-c'], captureArgs)).toEqual(['--out', '--config']);
    expect(missingValues(['--out=x', '--config', 'c', '--json'], captureArgs)).toEqual([]);
  });
});
