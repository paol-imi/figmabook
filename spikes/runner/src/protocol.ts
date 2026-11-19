/**
 * Messages between the UI iframe and the main thread. The UI drives every step; main only
 * runs named tasks and reports progress. Every message carries `kit` so stray messages from
 * other code are ignored.
 */
import type { WireValue } from '../../_shared/spike.ts';

export const KIT = 'holotype-spikes';

export type CallMessage = {
  readonly kit: typeof KIT;
  readonly t: 'call';
  readonly id: number;
  readonly task: string;
  readonly input: WireValue;
};

export type ResultMessage =
  | {
      readonly kit: typeof KIT;
      readonly t: 'result';
      readonly id: number;
      readonly ok: true;
      readonly output: WireValue;
    }
  | { readonly kit: typeof KIT; readonly t: 'result'; readonly id: number; readonly ok: false; readonly error: string };

export type ProgressMessage = {
  readonly kit: typeof KIT;
  readonly t: 'progress';
  readonly id: number;
  readonly message: string;
};

export type UiToMain = CallMessage;
export type MainToUi = ResultMessage | ProgressMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isCallMessage(value: unknown): value is CallMessage {
  return (
    isRecord(value) &&
    value.kit === KIT &&
    value.t === 'call' &&
    typeof value.id === 'number' &&
    typeof value.task === 'string'
  );
}

export function isMainToUi(value: unknown): value is MainToUi {
  return (
    isRecord(value) &&
    value.kit === KIT &&
    (value.t === 'result' || value.t === 'progress') &&
    typeof value.id === 'number'
  );
}
