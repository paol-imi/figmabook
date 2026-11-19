import { defineCommand, renderUsage } from 'citty';
import { description } from '../package.json';
import { captureCommand, captureMain } from './commands/capture';
import { usageError } from './commands/usage';
import { ExitCode } from './exit-codes';
import type { CliIo } from './output/io';
import type { CaptureDeps } from './pipeline/capture';
import { CLI_VERSION } from './pipeline/versions';

/** The root command, for `--help`. Subcommands are dispatched by {@link main}. */
export const rootCommand = defineCommand({
  meta: { name: 'holotype', version: CLI_VERSION, description },
  subCommands: { capture: captureCommand },
});

const HELP = new Set(['--help', '-h']);

/** Dependencies `main` passes to the commands (tests inject fakes). */
export interface MainDeps {
  readonly capture?: Partial<CaptureDeps>;
}

/**
 * The `holotype` CLI: runs the command named in `argv` and returns its exit code (11 §3.2).
 * Never calls `process.exit`, so it runs in-process in tests.
 */
export async function main(argv: readonly string[], io: CliIo, deps: MainDeps = {}): Promise<ExitCode> {
  const [command, ...rest] = argv;
  if (command === undefined || HELP.has(command)) {
    io.stdout(`${await renderUsage(rootCommand)}\n`);
    return command === undefined ? ExitCode.Usage : ExitCode.Ok;
  }
  if (command === '--version' || command === '-v') {
    io.stdout(`${CLI_VERSION}\n`);
    return ExitCode.Ok;
  }
  if (command === 'capture') {
    if (rest.some((arg) => HELP.has(arg))) {
      io.stdout(`${await renderUsage(captureCommand, { meta: { name: 'holotype', version: CLI_VERSION } })}\n`);
      return ExitCode.Ok;
    }
    return (await captureMain(rest, io, deps.capture)).exitCode;
  }
  return (await usageError(io, '', rootCommand, `Unknown command "${command}".`)).exitCode;
}
