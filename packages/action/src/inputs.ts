/** Inputs declared in `action.yml`. */
export interface ActionInputs {
  /** CLI command, e.g. `export` or `dcr`. */
  readonly command: string;
  /** Extra CLI arguments, whitespace-separated. */
  readonly args: readonly string[];
  readonly workingDirectory: string;
}

/**
 * Reads the action inputs from the environment the runner provides: an input named
 * `working-directory` arrives as `INPUT_WORKING-DIRECTORY`.
 */
export function parseInputs(env: Readonly<Record<string, string | undefined>>): ActionInputs {
  const input = (name: string) => env[`INPUT_${name.toUpperCase()}`]?.trim() ?? '';
  const command = input('command');
  if (command === '') throw new Error('Input "command" is required.');
  return {
    command,
    args: input('args').split(/\s+/).filter(Boolean),
    workingDirectory: input('working-directory') || '.',
  };
}
