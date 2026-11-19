import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogError, check, generate } from './run.ts';

const USAGE = 'Usage: diag-gen <gen|check> [--root <repository root>]';

/** Runs the CLI and returns the process exit code: 0 ok, 1 check failed, 2 usage error. */
export async function main(
  argv: readonly string[],
  log: Pick<Console, 'log' | 'warn' | 'error'> = console,
): Promise<number> {
  const [command, ...rest] = argv;
  let root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  for (let i = 0; i < rest.length; i++) {
    const value = rest[i + 1];
    if (rest[i] === '--root' && value !== undefined) {
      root = resolve(value);
      i++;
    } else {
      log.error(`Unknown argument "${rest[i]}".\n${USAGE}`);
      return 2;
    }
  }

  if (command === 'gen') {
    try {
      const { written, removed } = await generate(root);
      for (const path of written) log.log(`wrote ${path}`);
      for (const path of removed) log.log(`removed ${path}`);
      log.log(written.length + removed.length === 0 ? 'diag:gen: up to date' : 'diag:gen: done');
      return 0;
    } catch (error) {
      if (error instanceof CatalogError) {
        log.error(error.message);
        return 1;
      }
      throw error;
    }
  }

  if (command === 'check') {
    const { errors, warnings } = await check(root);
    for (const warning of warnings) log.warn(`warning: ${warning}`);
    for (const error of errors) log.error(`error: ${error}`);
    log.log(
      errors.length === 0
        ? `diag:check: ok (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`
        : `diag:check: ${errors.length} error${errors.length === 1 ? '' : 's'}`,
    );
    return errors.length === 0 ? 0 : 1;
  }

  log.error(USAGE);
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
