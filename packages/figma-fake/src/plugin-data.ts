import { figmaError } from './errors';

/** Plugin data entries are limited to 100 kB including namespace or plugin id and key (typings:6531-6537, 6553-6560). */
export const PLUGIN_DATA_LIMIT = 100_000;

const encoder = new TextEncoder();

export function checkEntrySize(api: string, owner: string, key: string, value: string): void {
  const size = encoder.encode(owner).length + encoder.encode(key).length + encoder.encode(value).length;
  if (size > PLUGIN_DATA_LIMIT) {
    throw figmaError(api, `Plugin data entry is too large: ${size} bytes (limit ${PLUGIN_DATA_LIMIT} bytes)`);
  }
}

/** "The namespace must be at least 3 alphanumeric characters" (typings:6553-6556). */
export function checkNamespace(api: string, namespace: unknown): string {
  if (typeof namespace !== 'string' || !/^[A-Za-z0-9]{3,}$/.test(namespace)) {
    throw figmaError(api, `Invalid namespace "${String(namespace)}": it must be at least 3 alphanumeric characters`);
  }
  return namespace;
}

export function checkKey(api: string, key: unknown): void {
  if (typeof key !== 'string') throw figmaError(api, 'Expected "key" to be a string');
}

export function checkValue(api: string, value: unknown): void {
  if (typeof value !== 'string') throw figmaError(api, 'Expected "value" to be a string');
}

/** Private and shared plugin data of one object; `''` deletes a key (typings:6524-6579). */
export class PluginDataStore {
  readonly private = new Map<string, string>();
  readonly shared = new Map<string, Map<string, string>>();

  get(api: string, key: string): string {
    checkKey(api, key);
    return this.private.get(key) ?? '';
  }

  set(api: string, pluginId: string, key: string, value: string): void {
    checkKey(api, key);
    checkValue(api, value);
    checkEntrySize(api, pluginId, key, value);
    if (value === '') this.private.delete(key);
    else this.private.set(key, value);
  }

  getShared(api: string, namespace: string, key: string): string {
    checkNamespace(api, namespace);
    checkKey(api, key);
    return this.shared.get(namespace)?.get(key) ?? '';
  }

  setShared(api: string, namespace: string, key: string, value: string): void {
    checkNamespace(api, namespace);
    checkKey(api, key);
    checkValue(api, value);
    checkEntrySize(api, namespace, key, value);
    const entries = this.shared.get(namespace) ?? new Map<string, string>();
    if (value === '') entries.delete(key);
    else entries.set(key, value);
    if (entries.size > 0) this.shared.set(namespace, entries);
    else this.shared.delete(namespace);
  }

  sharedKeys(api: string, namespace: string): string[] {
    checkNamespace(api, namespace);
    return [...(this.shared.get(namespace)?.keys() ?? [])];
  }
}
