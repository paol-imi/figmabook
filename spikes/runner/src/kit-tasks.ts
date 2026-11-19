/** Built-in main tasks every spike can use: environment facts and per-spike client storage. */
import type { JsonValue } from '../../_shared/json.ts';
import type { MainContext, WireValue } from '../../_shared/spike.ts';

/** Prefix of every clientStorage key the kit writes, so a reset can find them all. */
export const STORAGE_PREFIX = 'holotype-spikes';

export function storageKey(spike: string, key: string): string {
  return `${STORAGE_PREFIX}:${spike}:${key}`;
}

async function env({ figma }: MainContext, _input: null) {
  return { apiVersion: figma.apiVersion, editorType: figma.editorType };
}

async function stateGet({ figma }: MainContext, input: { spike: string; key: string }) {
  const value: unknown = await figma.clientStorage.getAsync(storageKey(input.spike, input.key));
  return { value: (value ?? null) as WireValue };
}

async function stateSet({ figma }: MainContext, input: { spike: string; key: string; value: JsonValue }) {
  await figma.clientStorage.setAsync(storageKey(input.spike, input.key), input.value);
  return { ok: true };
}

/** Forgets every stored step result and key of one spike (the "Start over" button). */
async function stateClear({ figma }: MainContext, input: { spike: string }) {
  const prefix = storageKey(input.spike, '');
  const keys = (await figma.clientStorage.keysAsync()).filter((key) => key.startsWith(prefix));
  for (const key of keys) await figma.clientStorage.deleteAsync(key);
  return { removed: keys.length };
}

export const kitTasks = {
  'kit/env': env,
  'kit/state.get': stateGet,
  'kit/state.set': stateSet,
  'kit/state.clear': stateClear,
};
