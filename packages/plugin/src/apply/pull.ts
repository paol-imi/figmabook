/*
 * The main side of the pull loop (09 §3.3): main asks for one unit with `need` and collects
 * the UI's `unit` answers, reassembling a component from its parts. The listener is in place
 * before `need` goes out, because the channel does not buffer, and it collects every part:
 * the UI may send all parts of a unit back to back.
 */
import { createDiagnostic, diagnostic, HolotypeError } from '@holotype/shared';
import type { MainChannel } from '../channel';
import type { TransferUnit, UnitRef } from '../protocol';

type UnitOf<K extends TransferUnit['kind']> = Extract<TransferUnit, { readonly kind: K }>;

export interface Puller {
  /** The whole Scene IR JSON of a component, reassembled from its parts. */
  component(sid: string): Promise<UnitOf<'component'>>;
  asset(sha256: string): Promise<UnitOf<'asset'>>;
}

function answers(ref: UnitRef, unit: TransferUnit): boolean {
  switch (ref.kind) {
    case 'tokens':
      return unit.kind === 'tokens';
    case 'component':
      return unit.kind === 'component' && unit.sid === ref.sid;
    case 'asset':
      return unit.kind === 'asset' && unit.sha256 === ref.sha256;
  }
}

const refLabel = (ref: UnitRef): string =>
  ref.kind === 'component' ? `component ${ref.sid}` : ref.kind === 'asset' ? `asset ${ref.sha256}` : 'tokens';

/** Pulls units one at a time over `channel`. */
export function createPuller(channel: MainChannel): Puller {
  const pull = (ref: UnitRef) =>
    new Promise<TransferUnit>((resolve, reject) => {
      const parts: string[] = [];
      let expected: number | undefined;
      let received = 0;
      const off = channel.on('unit', ({ unit }) => {
        if (!answers(ref, unit)) return;
        if (unit.kind !== 'component') {
          off();
          resolve(unit);
          return;
        }
        expected ??= unit.parts;
        if (unit.parts !== expected) {
          off();
          reject(
            new HolotypeError(
              createDiagnostic(diagnostic('APPLY_BUNDLE_CORRUPT'), undefined, {
                sid: unit.sid,
                value: refLabel(ref),
                data: { reason: `parts changed from ${expected} to ${unit.parts} during the transfer` },
              }),
            ),
          );
          return;
        }
        if (parts[unit.part] === undefined) received += 1;
        parts[unit.part] = unit.json;
        if (received === expected) {
          off();
          resolve({ ...unit, json: parts.join(''), part: 0, parts: 1 });
        }
      });
      channel.send({ t: 'need', unit: ref });
    });
  return {
    async component(sid) {
      const unit = await pull({ kind: 'component', sid });
      if (unit.kind !== 'component') throw new TypeError('Expected a component unit.');
      return unit;
    },
    async asset(sha256) {
      const unit = await pull({ kind: 'asset', sha256 });
      if (unit.kind !== 'asset') throw new TypeError('Expected an asset unit.');
      return unit;
    },
  };
}
