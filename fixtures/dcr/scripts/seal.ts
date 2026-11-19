// `pnpm -F @holotype/fixture-dcr seal [case…]`: derives hashes, ids and counts of the named
// cases (all cases without arguments), then formats what it wrote with Biome. Needs built
// workspace packages (`pnpm build`), because Node runs this file without a bundler.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { caseDir, listCases } from '../src/case.ts';
import { sealCase } from '../src/seal.ts';

const names = process.argv.slice(2);
const known = new Set(listCases());
const unknown = names.filter((name) => !known.has(name));
if (unknown.length > 0) {
  console.error(`Unknown case(s): ${unknown.join(', ')}. Known: ${[...known].join(', ')}.`);
  process.exit(1);
}

const written: string[] = [];
let failed = false;
for (const name of names.length > 0 ? names : [...known]) {
  try {
    const files = sealCase(name);
    for (const file of files) written.push(fileURLToPath(new URL(file, caseDir(name))));
    console.log(files.length > 0 ? `${name}: wrote ${files.join(', ')}` : `${name}: up to date`);
  } catch (error) {
    failed = true;
    console.error((error as Error).message);
  }
}

const json = written.filter((file) => file.endsWith('.json'));
if (json.length > 0) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  execFileSync('pnpm', ['exec', 'biome', 'format', '--write', ...json], { cwd: root, stdio: 'inherit' });
}
process.exit(failed ? 1 : 0);
