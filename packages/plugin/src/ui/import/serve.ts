/*
 * The UI side of the pull loop (09 §3.3): answers each `need` from main with the unit, a
 * component as its JSON string split into parts of at most 1 MB of UTF-8 (09 §3.2). A unit
 * the bundle lacks is answered empty, so main fails that one unit visibly instead of waiting.
 */
import type { UiChannel } from '../../channel';
import { MAX_PART_BYTES, type UnitRef } from '../../protocol';
import type { LoadedBundle } from './bundle';

function utf8Length(code: number): number {
  return code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
}

/**
 * Splits `text` into parts of at most `maxBytes` UTF-8 bytes each, never inside a surrogate
 * pair. Joining the parts gives `text` back.
 */
export function splitUtf8(text: string, maxBytes: number = MAX_PART_BYTES): string[] {
  if (maxBytes < 4) throw new RangeError('A part must hold at least one character (4 bytes).');
  const parts: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const pair = code >= 0xd800 && code <= 0xdbff && i + 1 < text.length;
    const size = pair ? 4 : utf8Length(code);
    if (bytes + size > maxBytes) {
      parts.push(text.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += size;
    if (pair) i += 1;
  }
  parts.push(text.slice(start));
  return parts;
}

/** Serves `bundle` to main until the returned function is called. */
export function serveBundle(channel: UiChannel, bundle: LoadedBundle, maxPartBytes = MAX_PART_BYTES): () => void {
  let seq = 0;
  const answer = (ref: UnitRef) => {
    switch (ref.kind) {
      case 'component': {
        const parts = splitUtf8(bundle.components.get(ref.sid) ?? '', maxPartBytes);
        parts.forEach((json, part) => {
          const last = part === parts.length - 1;
          channel.send({
            t: 'unit',
            seq: seq++,
            unit: { kind: 'component', sid: ref.sid, json, part, parts: parts.length },
            last,
          });
        });
        return;
      }
      case 'asset': {
        const asset = bundle.assets.get(ref.sha256);
        const unit = {
          kind: 'asset',
          sha256: ref.sha256,
          mime: asset?.mime ?? '',
          bytes: asset?.bytes ?? new Uint8Array(),
        } as const;
        channel.send({ t: 'unit', seq: seq++, unit, last: true });
        return;
      }
      case 'tokens':
        // The slice imports no tokens (B-60): main does not ask; an empty answer keeps it from waiting.
        channel.send({ t: 'unit', seq: seq++, unit: { kind: 'tokens', json: '' }, last: true });
        return;
    }
  };
  return channel.on('need', ({ unit }) => answer(unit));
}
