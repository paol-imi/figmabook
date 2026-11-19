/** Where a command writes, and what it reads from its environment. Injected for tests. */
export interface CliIo {
  /** Machine output (`--json`) and the human summary. */
  readonly stdout: (text: string) => void;
  /** Progress and logs (11 §3.1: human logs go to stderr under `--json`). */
  readonly stderr: (text: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** Aborted on SIGINT. */
  readonly signal?: AbortSignal;
}

/** The real process streams and environment. */
export function processIo(signal?: AbortSignal): CliIo {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    cwd: process.cwd(),
    ...(signal === undefined ? {} : { signal }),
  };
}
