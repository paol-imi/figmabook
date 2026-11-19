/** First difference between two JSON values, as a path (`$.root.children[2].text`). Pure. */

type Value = unknown;

const kind = (value: Value): string => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value);

/**
 * The path of the first place where `a` and `b` differ, depth first in key order, or `null`
 * when they are equal. Top-level keys in `ignore` are skipped (volatile capture fields).
 */
export function firstDifference(a: Value, b: Value, ignore: readonly string[] = []): string | null {
  const walk = (x: Value, y: Value, path: string, top: boolean): string | null => {
    const kx = kind(x);
    if (kx !== kind(y)) return `${path} (${kx} vs ${kind(y)})`;
    if (Array.isArray(x) && Array.isArray(y)) {
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        if (i >= x.length || i >= y.length) return `${path}[${i}] (length ${x.length} vs ${y.length})`;
        const found = walk(x[i], y[i], `${path}[${i}]`, false);
        if (found !== null) return found;
      }
      return null;
    }
    if (kx === 'object') {
      const ox = x as Record<string, Value>;
      const oy = y as Record<string, Value>;
      const keys = [...new Set([...Object.keys(ox), ...Object.keys(oy)])].sort();
      for (const key of keys) {
        if (top && ignore.includes(key)) continue;
        if (!(key in ox) || !(key in oy)) return `${path}.${key} (missing on one side)`;
        const found = walk(ox[key], oy[key], `${path}.${key}`, false);
        if (found !== null) return found;
      }
      return null;
    }
    return Object.is(x, y) ? null : `${path} (${JSON.stringify(x)} vs ${JSON.stringify(y)})`;
  };
  return walk(a, b, '$', true);
}
