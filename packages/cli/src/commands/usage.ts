import { PLAYWRIGHT_VERSION } from '@holotype/capture';
import { type ArgsDef, type CommandDef, renderUsage } from 'citty';
import { ExitCode } from '../exit-codes';
import type { CliIo } from '../output/io';
import { CLI_VERSION } from '../pipeline/versions';
import type { RunReport } from '../run-report';

/** What a command returns to `main`. */
export interface CommandOutcome {
  readonly exitCode: ExitCode;
  /** The bundle written, if any. */
  readonly bundle?: string;
}

/** The `RunReport` of a command that stopped on its flags, for `--json` (12 §7.1). */
export function usageReport(command: string, message: string, hint: string): RunReport {
  return {
    reportVersion: '1',
    run: {
      id: '',
      command,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      surface: 'cli',
      exitCode: ExitCode.Usage,
      generator: { name: '@holotype/cli', version: CLI_VERSION, chromium: 'unknown', playwright: PLAYWRIGHT_VERSION },
    },
    totals: { components: 0, ok: 0, failed: 0, variants: 0, nodes: 0, autoLayoutCoverage: 0 },
    components: [],
    diagnosticsByCode: {},
    budgets: [],
    diagnostics: [],
    failure: { message, hint },
  };
}

/**
 * Reports a flag error (11 §3.2: exit 2): the message and the command's usage on stderr,
 * plus a `RunReport` on stdout under `--json`.
 */
export async function usageError<T extends ArgsDef>(
  io: CliIo,
  name: string,
  command: CommandDef<T>,
  message: string,
  json = false,
): Promise<CommandOutcome> {
  const hint = name === '' ? 'Run holotype --help for the commands.' : `Run holotype ${name} --help for the flags.`;
  io.stderr(
    `${await renderUsage(command, name === '' ? undefined : { meta: { name: 'holotype', version: CLI_VERSION } })}\n\n✖ ${message}\n  ${hint}\n`,
  );
  if (json) io.stdout(`${JSON.stringify(usageReport(name, message, hint), null, 2)}\n`);
  return { exitCode: ExitCode.Usage };
}
