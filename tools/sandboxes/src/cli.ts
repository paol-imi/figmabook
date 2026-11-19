/**
 * `pnpm -F @holotype/sandboxes gen <template> [options]`: generates (and optionally installs and
 * builds) a throwaway Storybook sandbox. `list` prints the templates and overlays.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_OUT_ROOT, generateSandbox } from './generate.ts';
import { buildSandbox, installSandbox } from './setup.ts';
import { OVERLAYS, PLANNED_TEMPLATES, TEMPLATES } from './templates.ts';

export const USAGE = `Usage:
  sandboxes gen <template> [--overlay <id>]... [--storybook <version>] [--out <dir>] [--force] [--install] [--offline] [--build <dir>]
  sandboxes list`;

export interface GenCommand {
  readonly command: 'gen';
  readonly template: string;
  readonly overlays: readonly string[];
  readonly storybookVersion?: string;
  readonly outRoot: string;
  readonly force: boolean;
  readonly install: boolean;
  readonly offline: boolean;
  /** Static build output, relative to the sandbox; implies `install`. */
  readonly build?: string;
}

export type Command = GenCommand | { readonly command: 'list' };

/** Parses the command line (without `node` and the script). Throws with the usage on bad input. */
export function parseCommand(argv: readonly string[]): Command {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      overlay: { type: 'string', multiple: true },
      storybook: { type: 'string' },
      out: { type: 'string' },
      force: { type: 'boolean' },
      install: { type: 'boolean' },
      offline: { type: 'boolean' },
      build: { type: 'string' },
    },
  });
  const [command, template, ...rest] = positionals;
  if (command === 'list' && template === undefined) return { command: 'list' };
  if (command !== 'gen' || template === undefined || rest.length > 0) throw new Error(USAGE);
  return {
    command: 'gen',
    template,
    overlays: values.overlay ?? [],
    ...(values.storybook === undefined ? {} : { storybookVersion: values.storybook }),
    outRoot: values.out ?? DEFAULT_OUT_ROOT,
    force: values.force === true,
    install: values.install === true || values.build !== undefined,
    offline: values.offline === true,
    ...(values.build === undefined ? {} : { build: values.build }),
  };
}

export function listing(): string {
  const lines = ['Templates:'];
  for (const template of TEMPLATES) lines.push(`  ${template.id}  (Storybook ${template.versions.storybook})`);
  for (const [id, why] of Object.entries(PLANNED_TEMPLATES)) lines.push(`  ${id}  (not yet: ${why})`);
  lines.push('Overlays:');
  for (const [id, what] of Object.entries(OVERLAYS)) lines.push(`  ${id}  ${what}`);
  return lines.join('\n');
}

async function main(argv: readonly string[]): Promise<void> {
  const command = parseCommand(argv);
  if (command.command === 'list') {
    console.log(listing());
    return;
  }
  const sandbox = await generateSandbox(command);
  console.log(`Generated ${sandbox.name} (Storybook ${sandbox.manifest.storybook}) in ${sandbox.dir}`);
  if (command.install) {
    await installSandbox(sandbox.dir, { offline: command.offline });
    console.log('Installed dependencies.');
  }
  if (command.build !== undefined) {
    const out = await buildSandbox(sandbox.dir, command.build);
    console.log(`Built the static Storybook into ${out}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
