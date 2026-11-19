/**
 * Packaging helpers for the kit: the UI HTML shell and a deterministic zip (fixed order and
 * timestamps, 02 §6.4), so the same sources always give the same bytes.
 * Runs under Node type stripping: no TypeScript-only runtime syntax here.
 */
import { zipSync } from 'fflate';

/** Folder name inside the zip. Unzipping always gives the same folder, so Figma keeps the import. */
export const KIT_FOLDER = 'holotype-spikes';

/** Wraps the UI bundle in the HTML document Figma loads as `__html__`. */
export function uiHtml(script: string): string {
  // A literal "</script" inside the bundle would end the inline script early.
  const safe = script.replaceAll('</script', '<\\/script');
  return `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Holotype Spikes</title></head>\n<body><div id="app"></div><script>${safe}</script></body>\n</html>\n`;
}

/**
 * Fixed timestamp for every entry. Built with the local-time constructor because the zip
 * format stores local DOS time: the stored fields are then the same in every time zone.
 */
function fixedTime(): Date {
  return new Date(2026, 0, 1, 0, 0, 0);
}

/** Zips `files` (path → content) under `KIT_FOLDER/`, sorted by path. */
export function zipKit(files: Readonly<Record<string, Uint8Array | string>>): Uint8Array {
  const encoder = new TextEncoder();
  const mtime = fixedTime();
  const entries: Record<string, [Uint8Array, { mtime: Date; level: 9 }]> = {};
  for (const path of Object.keys(files).sort()) {
    const content = files[path];
    if (content === undefined) continue;
    entries[`${KIT_FOLDER}/${path}`] = [
      typeof content === 'string' ? encoder.encode(content) : content,
      { mtime, level: 9 },
    ];
  }
  return zipSync(entries, { mtime, level: 9 });
}
