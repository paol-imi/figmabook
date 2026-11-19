/** Regenerates the Chromium reference data bundled into the kit (S-05). Needs Playwright's Chromium. */
import { writeFile } from 'node:fs/promises';
import { renderRefs } from '../../S-05/refs.ts';

const refs = await renderRefs();
const target = new URL('../../S-05/refs.json', import.meta.url);
await writeFile(target, `${JSON.stringify(refs, null, 2)}\n`);
console.log(`S-05: ${Object.keys(refs.cases).length} reference cases written with ${refs.renderer}.`);
