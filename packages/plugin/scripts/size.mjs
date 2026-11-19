// @ts-check
// `pnpm size`: fails when a plugin bundle exceeds its budget (D-04, 02 §6.2, BUILD §2.2).
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const KB = 1024;

/** Byte budgets of the built bundles, relative to the package root. */
export const BUDGETS = Object.freeze({ 'build/main.js': 400 * KB, 'build/ui.js': 600 * KB });

/**
 * @typedef {{ file: string; size: number; budget: number; ok: boolean }} SizeResult
 */

/**
 * Measures each budgeted file under `root`.
 * @param {URL} root package root, with a trailing slash
 * @param {Readonly<Record<string, number>>} [budgets]
 * @returns {Promise<SizeResult[]>}
 */
export async function checkBundleSizes(root, budgets = BUDGETS) {
  const results = [];
  for (const [file, budget] of Object.entries(budgets)) {
    let size;
    try {
      ({ size } = await stat(new URL(file, root)));
    } catch (error) {
      throw new Error(`${file} is missing. Run \`pnpm -F @holotype/plugin build\` first.`, { cause: error });
    }
    results.push({ file, size, budget, ok: size <= budget });
  }
  return results;
}

/**
 * One line per file, e.g. `✓ build/main.js: 1.9 KB (budget 400 KB)`.
 * @param {SizeResult} result
 */
export function formatResult({ file, size, budget, ok }) {
  return `${ok ? '✓' : '✗'} ${file}: ${(size / KB).toFixed(1)} KB (budget ${budget / KB} KB)`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const results = await checkBundleSizes(new URL('../', import.meta.url));
    for (const result of results) console.log(formatResult(result));
    if (results.some((result) => !result.ok)) {
      console.error('Plugin bundle over budget. Check for a new dependency pulled into main or UI.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
