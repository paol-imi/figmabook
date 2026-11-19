/** Log levels, most to least severe (02 §10). */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** A `--log-level` value: a level, or `silent` for nothing. */
export type LogThreshold = LogLevel | 'silent';

/** One structured log record, as the CLI writes it to `.holotype/logs/` (NDJSON). */
export interface LogRecord {
  readonly ts: string;
  readonly level: LogLevel;
  readonly runId: string;
  readonly sid?: string;
  readonly vk?: string;
  readonly msg: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** Context bound to a child logger. */
export interface LogContext {
  readonly sid?: string;
  readonly vk?: string;
}

/**
 * The logger every package writes to. Implementations live at the edges: the CLI writes
 * NDJSON and pretty TTY output, the plugin keeps a ring buffer in UI memory.
 */
export interface Logger {
  error(msg: string, data?: Readonly<Record<string, unknown>>): void;
  warn(msg: string, data?: Readonly<Record<string, unknown>>): void;
  info(msg: string, data?: Readonly<Record<string, unknown>>): void;
  debug(msg: string, data?: Readonly<Record<string, unknown>>): void;
  trace(msg: string, data?: Readonly<Record<string, unknown>>): void;
  child(context: LogContext): Logger;
}

const LEVELS: readonly LogThreshold[] = ['silent', 'error', 'warn', 'info', 'debug', 'trace'];

/** Whether a record at `level` passes the `threshold`. */
export function isLevelEnabled(threshold: LogThreshold, level: LogLevel): boolean {
  return LEVELS.indexOf(level) <= LEVELS.indexOf(threshold);
}
