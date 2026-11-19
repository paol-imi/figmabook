/** The `react-vite@10.6` sandbox with the `faults` overlay, generated, installed and built. */
import { join } from 'node:path';
import { buildSandbox, generateSandbox, installSandbox } from '@holotype/sandboxes';

export const SANDBOX_TEMPLATE = 'react-vite@10.6';
export const SANDBOX_OVERLAYS: readonly string[] = ['faults'];

export interface PreparedSandbox {
  readonly dir: string;
  readonly staticDir: string;
  readonly storybook: string;
}

/** Regenerates the sandbox (keeping its `node_modules`), installs and builds it. */
export async function prepareSandbox(log: (line: string) => void): Promise<PreparedSandbox> {
  const sandbox = await generateSandbox({ template: SANDBOX_TEMPLATE, overlays: SANDBOX_OVERLAYS, force: true });
  await installSandbox(sandbox.dir);
  const staticDir = await buildSandbox(sandbox.dir, join(sandbox.dir, 'storybook-static'));
  log(`sandbox ${sandbox.name} (Storybook ${sandbox.manifest.storybook}) built in ${staticDir}`);
  return { dir: sandbox.dir, staticDir, storybook: sandbox.manifest.storybook };
}
