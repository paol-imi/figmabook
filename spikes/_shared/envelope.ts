/**
 * The paste-back result envelope (BUILD §9.1):
 * `{ spike, kitVersion, step, status, env: { apiVersion, editorType, client, os }, results }`.
 * It never carries the user's name, email or file names.
 */
import type { JsonObject } from './json.ts';
import type { SpikeEnv } from './spike.ts';

export const ENVELOPE_FORMAT = 'holotype-spike-result/1';

export type ResultEnvelope = {
  readonly format: typeof ENVELOPE_FORMAT;
  readonly spike: string;
  readonly kitVersion: string;
  readonly step: string;
  readonly status: 'done' | 'failed';
  readonly env: SpikeEnv;
  readonly results: JsonObject;
};

export function buildEnvelope(fields: Omit<ResultEnvelope, 'format'>): ResultEnvelope {
  return {
    format: ENVELOPE_FORMAT,
    spike: fields.spike,
    kitVersion: fields.kitVersion,
    step: fields.step,
    status: fields.status,
    env: fields.env,
    results: fields.results,
  };
}

/** Classifies the client from the UI iframe's user agent. Only the coarse class leaves the plugin. */
export function detectClient(userAgent: string): Pick<SpikeEnv, 'client' | 'os'> {
  const client: SpikeEnv['client'] = /\bFigma(Desktop)?\//i.test(userAgent)
    ? 'desktop'
    : /Mozilla\//.test(userAgent)
      ? 'browser'
      : 'unknown';
  const os: SpikeEnv['os'] = /CrOS/.test(userAgent)
    ? 'chromeos'
    : /Mac OS X|Macintosh/.test(userAgent)
      ? 'macos'
      : /Windows/.test(userAgent)
        ? 'windows'
        : /Linux/.test(userAgent)
          ? 'linux'
          : 'other';
  return { client, os };
}

/** Results over this many UTF-8 bytes are split into numbered parts (BUILD §9.1). */
export const PART_LIMIT_BYTES = 30_000;

const PART_HEADER = /^HOLOTYPE-SPIKE-PART (\S+) (\S+) (\d+)\/(\d+)\n/;

/**
 * Splits a result text into paste-sized parts. A single part is returned unchanged; several
 * parts each start with a header line `HOLOTYPE-SPIKE-PART <spike> <step> <n>/<total>`.
 * Splits on code points, so no character is cut in half.
 */
export function splitIntoParts(
  text: string,
  label: { readonly spike: string; readonly step: string },
  limitBytes = PART_LIMIT_BYTES,
): string[] {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= limitBytes) return [text];
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limitBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }
  if (current) chunks.push(current);
  return chunks.map(
    (chunk, index) => `HOLOTYPE-SPIKE-PART ${label.spike} ${label.step} ${index + 1}/${chunks.length}\n${chunk}`,
  );
}

/** Reassembles pasted parts in any order (used by the analysis agent and by tests). */
export function joinParts(parts: readonly string[]): string {
  if (parts.length === 1 && !PART_HEADER.test(parts[0] ?? '')) return parts[0] ?? '';
  const parsed = parts.map((part) => {
    const match = PART_HEADER.exec(part);
    if (!match) throw new Error('A pasted part has no "HOLOTYPE-SPIKE-PART" header line.');
    return { index: Number(match[3]), total: Number(match[4]), body: part.slice(match[0].length) };
  });
  const total = parsed[0]?.total ?? 0;
  const ordered = [...parsed].sort((a, b) => a.index - b.index);
  const complete = ordered.length === total && ordered.every((part, i) => part.index === i + 1 && part.total === total);
  if (!complete) throw new Error(`Expected parts 1…${total}, got ${ordered.map((p) => p.index).join(', ')}.`);
  return ordered.map((part) => part.body).join('');
}

/** File name for "Save results file": no user or document names, only spike and step. */
export function resultFileName(spike: string, step: string, part?: { index: number; total: number }): string {
  const suffix = part && part.total > 1 ? `-part${part.index}of${part.total}` : '';
  return `holotype-${spike.toLowerCase()}-${step}${suffix}.json`;
}
