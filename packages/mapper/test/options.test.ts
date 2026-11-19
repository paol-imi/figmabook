import { NotImplementedError } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPPER_OPTIONS, mapComponent, resolveMapperOptions } from '../src';

describe('mapper options', () => {
  it('defaults to the README §5 decisions', () => {
    expect(DEFAULT_MAPPER_OPTIONS).toEqual({ tolSim: 0.6, textWrapMode: 'reflow', tokenValueMatching: false });
  });

  it('merges overrides and rejects impossible tolerances', () => {
    expect(resolveMapperOptions({ textWrapMode: 'locked-lines' })).toEqual({
      ...DEFAULT_MAPPER_OPTIONS,
      textWrapMode: 'locked-lines',
    });
    expect(() => resolveMapperOptions({ tolSim: -1 })).toThrow(RangeError);
    expect(() => resolveMapperOptions({ tolSim: Number.NaN })).toThrow(RangeError);
  });

  it('validates options before reporting that mapping is not built yet', () => {
    expect(() => mapComponent({ sid: 'components-button', captures: [], options: { tolSim: -1 } })).toThrow(RangeError);
    expect(() => mapComponent({ sid: 'components-button', captures: [] })).toThrow(NotImplementedError);
  });
});
