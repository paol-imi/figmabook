/**
 * `pnpm fonts:lock` rewrites `fixtures/fonts.lock` from `src/styles/fonts.css`.
 * `pnpm fonts:lock --check` exits 1 when the committed lock is out of date.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { computeFontsLock, fontsLockPath, serializeFontsLock } from './fonts-lock.ts';

const next = serializeFontsLock(computeFontsLock());

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(fontsLockPath, 'utf8');
  } catch {
    // A missing lock is reported as out of date below.
  }
  if (current !== next) {
    console.error(`${fontsLockPath} is out of date. Run \`pnpm -F @holotype/fixture-ds-react fonts:lock\`.`);
    process.exit(1);
  }
  console.log(`${fontsLockPath} is up to date.`);
} else {
  writeFileSync(fontsLockPath, next);
  console.log(`Wrote ${fontsLockPath}.`);
}
