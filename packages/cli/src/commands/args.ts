import type { ArgsDef } from 'citty';

/*
 * Flag helpers on top of citty's parser, which accepts unknown flags and keeps only the
 * last value of a repeated one. 11 §3.2 makes invalid flags a usage error (exit 2), and
 * `--story` may be repeated.
 */

const BUILTIN = new Set(['help', 'h', 'version', 'v']);

function aliasesOf(arg: ArgsDef[string]): string[] {
  return 'alias' in arg && arg.alias !== undefined ? [arg.alias].flat() : [];
}

function names(def: ArgsDef): Set<string> {
  const known = new Set(BUILTIN);
  for (const [name, arg] of Object.entries(def)) {
    if (arg.type === 'positional') continue;
    known.add(name);
    for (const alias of aliasesOf(arg)) known.add(alias);
  }
  return known;
}

/** Flags in `argv` that `def` does not declare, as typed (`--colour`). */
export function unknownFlags(argv: readonly string[], def: ArgsDef): string[] {
  const known = names(def);
  const unknown: string[] = [];
  for (const token of argv) {
    if (token === '--') break;
    if (!token.startsWith('-') || token === '-') continue;
    const name = token.replace(/^--?/, '').split('=')[0] ?? '';
    const bare = name.startsWith('no-') && known.has(name.slice(3)) ? name.slice(3) : name;
    if (!known.has(bare)) unknown.push(token.split('=')[0] ?? token);
  }
  return unknown;
}

/**
 * Every value of a repeatable string flag (`--story a --story=b,c` → `a`, `b`, `c`): each
 * occurrence may hold a comma-separated list. Empty items are dropped.
 */
export function repeatedValues(argv: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? '';
    if (token === '--') break;
    let value: string | undefined;
    if (token === `--${name}`) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        value = next;
        i++;
      }
    } else if (token.startsWith(`--${name}=`)) {
      value = token.slice(name.length + 3);
    }
    if (value !== undefined) values.push(...value.split(',').map((item) => item.trim()));
  }
  return values.filter((item) => item !== '');
}

/** String flags given without a value (`--out` at the end of the line). */
export function missingValues(argv: readonly string[], def: ArgsDef): string[] {
  const missing: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? '';
    if (token === '--') break;
    if (!token.startsWith('-')) continue;
    const name = token.replace(/^--?/, '');
    const entry = Object.entries(def).find(
      ([key, arg]) => (key === name || aliasesOf(arg).includes(name)) && arg.type === 'string',
    );
    if (entry === undefined || token.includes('=')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('-')) missing.push(`--${entry[0]}`);
  }
  return missing;
}
