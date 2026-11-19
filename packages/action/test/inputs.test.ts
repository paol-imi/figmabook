import { describe, expect, it } from 'vitest';
import { parseInputs } from '../src/inputs';

describe('parseInputs', () => {
  it('reads INPUT_* variables the way the Actions runner names them', () => {
    expect(
      parseInputs({
        INPUT_COMMAND: ' export ',
        INPUT_ARGS: '--out  bundle.holotype.zip',
        'INPUT_WORKING-DIRECTORY': 'apps/ui',
      }),
    ).toEqual({ command: 'export', args: ['--out', 'bundle.holotype.zip'], workingDirectory: 'apps/ui' });
  });

  it('defaults optional inputs and requires a command', () => {
    expect(parseInputs({ INPUT_COMMAND: 'dcr' })).toEqual({ command: 'dcr', args: [], workingDirectory: '.' });
    expect(() => parseInputs({ INPUT_ARGS: '--json' })).toThrow(/command/);
  });
});
