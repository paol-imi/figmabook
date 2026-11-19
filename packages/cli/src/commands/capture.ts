import { resolve } from 'node:path';
import { defineCommand, parseArgs } from 'citty';
import { formatCaptureSummary, formatProgress } from '../output/human';
import type { CliIo } from '../output/io';
import { type CaptureDeps, type CaptureRunOptions, runCapture } from '../pipeline/capture';
import { missingValues, repeatedValues, unknownFlags } from './args';
import { type CommandOutcome, usageError } from './usage';

export const captureArgs = {
  storybook: {
    type: 'string',
    valueHint: 'dir|url',
    description: 'Storybook static build directory or URL (overrides storybook.source)',
  },
  story: {
    type: 'string',
    valueHint: 'id',
    description: 'Story to capture, e.g. components-button--primary. Repeat it or give a comma list',
  },
  out: {
    type: 'string',
    valueHint: 'dir|file.holotype.zip',
    description:
      'Where to write the bundle: a .holotype.zip file or a directory (default .holotype/out/<runId>.holotype.zip)',
  },
  config: {
    type: 'string',
    alias: 'c',
    valueHint: 'path',
    description: 'Config file (default: the nearest holotype.config.*)',
  },
  cwd: { type: 'string', valueHint: 'dir', description: 'Working directory' },
  json: { type: 'boolean', description: 'Print one JSON document (RunReport) on stdout; progress goes to stderr' },
} as const;

export const captureCommand = defineCommand({
  meta: {
    name: 'capture',
    description: 'Render stories, capture them and write a bundle the Figma plugin imports',
  },
  args: captureArgs,
});

/** A positive integer of seconds since the epoch, or `undefined` (reproducible-builds convention). */
export function sourceDateEpoch(env: CliIo['env']): Date | undefined {
  const value = env.SOURCE_DATE_EPOCH;
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return new Date(Number(value) * 1000);
}

/** Runs `holotype capture` with `argv` (the words after `capture`). */
export async function captureMain(
  argv: readonly string[],
  io: CliIo,
  deps: Partial<CaptureDeps> = {},
): Promise<CommandOutcome> {
  const json = argv.includes('--json');
  const unknown = unknownFlags(argv, captureArgs);
  if (unknown.length > 0) return usageError(io, 'capture', captureCommand, `Unknown flag ${unknown.join(', ')}.`, json);
  const missing = missingValues(argv, captureArgs);
  if (missing.length > 0)
    return usageError(io, 'capture', captureCommand, `${missing.join(', ')} needs a value.`, json);
  const args = parseArgs<typeof captureArgs>([...argv], captureArgs);
  if (args._.length > 0) return usageError(io, 'capture', captureCommand, `Unexpected argument "${args._[0]}".`, json);
  const cwd = args.cwd === undefined ? io.cwd : resolve(io.cwd, args.cwd);
  const createdAt = sourceDateEpoch(io.env);
  const chromiumPath = io.env.HOLOTYPE_CHROMIUM_PATH;
  const options: CaptureRunOptions = {
    stories: repeatedValues(argv, 'story'),
    cwd,
    ...(args.storybook === undefined ? {} : { storybook: args.storybook }),
    ...(args.out === undefined ? {} : { out: args.out }),
    ...(args.config === undefined ? {} : { config: args.config }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(chromiumPath === undefined || chromiumPath === '' ? {} : { chromiumPath }),
    ...(io.signal === undefined ? {} : { signal: io.signal }),
    onProgress: (event) => {
      if (event.kind === 'connected') {
        const { caps } = event.storybook;
        const count = event.stories === 1 ? '1 story' : `${event.stories} stories`;
        io.stderr(formatProgress(`Storybook ${caps.version ?? '(version unknown)'} · capturing ${count}…`));
      } else {
        io.stderr(formatProgress(`  ${event.ok ? '✔' : '✖'} ${event.storyId}`));
      }
    },
  };
  const result = await runCapture(options, deps);
  if (json) io.stdout(`${JSON.stringify(result.report, null, 2)}\n`);
  else io.stdout(formatCaptureSummary(result.report, cwd));
  return { exitCode: result.exitCode, ...(result.bundle === undefined ? {} : { bundle: result.bundle.path }) };
}
