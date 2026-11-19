import { buildForSmoke } from '../scripts/build.ts';

/** Builds the CLI (the smoke runs its binary) and the plugin (its size budgets are checked). */
export default async function setup(): Promise<void> {
  await buildForSmoke();
}
