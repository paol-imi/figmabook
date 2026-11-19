// Fails the build when a plugin bundle exceeds its budget (D-04, 02 §6.2).
import { stat } from 'node:fs/promises';

const KB = 1024;
const budgets = { 'build/main.js': 400 * KB, 'build/ui.js': 600 * KB };

let failed = false;
for (const [file, budget] of Object.entries(budgets)) {
  const { size } = await stat(new URL(`../${file}`, import.meta.url));
  const over = size > budget;
  failed ||= over;
  console.log(`${over ? '✗' : '✓'} ${file}: ${(size / KB).toFixed(1)} KB (budget ${budget / KB} KB)`);
}
if (failed) process.exit(1);
