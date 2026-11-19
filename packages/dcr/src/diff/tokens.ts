import type { JsonValue } from '@holotype/ir';
import { asNumber, field, isObject, sortedKeys, uniqueSorted } from '../identify/json';
import type { SnapVariable } from '../schema';

/*
 * Tokens (15 §4.7, 08). A bound value names its variable's `codeSyntax.WEB` (`var(--space-4)`
 * → `--space-4`). A raw value is matched against the variables of the same type whose Figma
 * `scopes` allow the field, by exact normalized equality (floats to 1e-3, colors to 1e-4);
 * every match is a candidate, sorted by name.
 */

/** Figma variable scopes, by what a field binds (Plugin API `VariableScope`). */
export type TokenScope =
  | 'GAP'
  | 'CORNER_RADIUS'
  | 'WIDTH_HEIGHT'
  | 'STROKE_FLOAT'
  | 'OPACITY'
  | 'FONT_SIZE' // diag-check-ignore: a Figma VariableScope, not a diagnostic
  | 'LINE_HEIGHT'
  | 'LETTER_SPACING'
  | 'PARAGRAPH_SPACING'
  | 'FRAME_FILL'
  | 'SHAPE_FILL'
  | 'TEXT_FILL' // diag-check-ignore: a Figma VariableScope, not a diagnostic
  | 'STROKE_COLOR'
  | 'EFFECT_COLOR';

const FILL_SCOPES: ReadonlySet<TokenScope> = new Set(['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL']); // diag-check-ignore: a Figma VariableScope, not a diagnostic

/** A value to match: a number, or a color with its alpha. */
export type TokenValue =
  | { readonly kind: 'FLOAT'; readonly value: number }
  | { readonly kind: 'COLOR'; readonly rgba: Rgba };

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const MAX_ALIAS_DEPTH = 16;

/** The alias target of a variable value `{ alias: <variable id> }`. */
export const aliasOf = (value: JsonValue | undefined): string | undefined => {
  const alias = field(value, 'alias');
  return typeof alias === 'string' ? alias : undefined;
};

/** A color value (`{ r, g, b, a? }`) as RGBA. */
export function rgbaOf(value: JsonValue | undefined, opacity = 1): Rgba | undefined {
  if (!isObject(value)) return undefined;
  const r = asNumber(value.r);
  const g = asNumber(value.g);
  const b = asNumber(value.b);
  if (r === undefined || g === undefined || b === undefined) return undefined;
  return { r, g, b, a: (asNumber(value.a) ?? 1) * opacity };
}

export class TokenIndex {
  private readonly variables: Readonly<Record<string, SnapVariable>>;
  private names: Map<string, string> | undefined;

  constructor(variables: Readonly<Record<string, SnapVariable>>) {
    this.variables = variables;
  }

  variable(id: string | undefined): SnapVariable | undefined {
    return id === undefined ? undefined : this.variables[id];
  }

  /** Every variable id in code-unit order. */
  ids(): string[] {
    return sortedKeys(this.variables);
  }

  /**
   * The CSS custom property a variable stands for: `codeSyntax.WEB`, else its `tok`, else its
   * name with 08's naming rule in reverse (`Color/Brand accent` → `--color-brand-accent`).
   */
  cssName(id: string): string | undefined {
    const variable = this.variables[id];
    if (!variable) return undefined;
    const web = variable.codeSyntax?.WEB?.match(/^var\((--[^),\s]+)\)$/)?.[1];
    if (web) return web;
    if (variable.data.tok?.startsWith('--')) return variable.data.tok;
    return cssNameFromVariableName(variable.name);
  }

  /** The Figma name of the variable a CSS name stands for (the first by id when several do). */
  figmaName(css: string): string | undefined {
    if (this.names === undefined) {
      this.names = new Map();
      for (const id of this.ids()) {
        const name = this.cssName(id);
        if (name !== undefined && !this.names.has(name)) this.names.set(name, this.variables[id]?.name ?? name);
      }
    }
    return this.names.get(css);
  }

  /** The mode the extractor reads a variable in: its first mode id in code-unit order. */
  modeOf(variable: SnapVariable): string | undefined {
    return sortedKeys(variable.valuesByMode)[0];
  }

  /** A variable's value with aliases followed, in each variable's own first mode. */
  resolve(id: string): JsonValue | undefined {
    let current = this.variables[id];
    for (let depth = 0; current && depth < MAX_ALIAS_DEPTH; depth++) {
      const mode = this.modeOf(current);
      const value = mode === undefined ? undefined : current.valuesByMode[mode];
      const alias = aliasOf(value);
      if (alias === undefined) return value;
      current = this.variables[alias];
    }
    return undefined;
  }

  /** CSS names of the variables whose resolved value is `value` and whose scopes allow `scope`, sorted. */
  candidates(value: TokenValue, scope: TokenScope): string[] {
    const names: string[] = [];
    for (const id of this.ids()) {
      const variable = this.variables[id] as SnapVariable;
      if (variable.resolvedType !== value.kind || !allows(variable, scope)) continue;
      const resolved = this.resolve(id);
      if (!matches(resolved, value)) continue;
      const name = this.cssName(id);
      if (name !== undefined) names.push(name);
    }
    return uniqueSorted(names);
  }
}

/** `Color/Brand accent` → `--color-brand-accent` (08 naming rule in reverse). */
export function cssNameFromVariableName(name: string): string | undefined {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? `--${slug}` : undefined;
}

/** Figma `scopes`, an open field of the snapshot: absent means every scope (Figma's default). */
function scopesOf(variable: SnapVariable): readonly string[] | undefined {
  const scopes = (variable as SnapVariable & { scopes?: unknown }).scopes;
  return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === 'string') : undefined;
}

function allows(variable: SnapVariable, scope: TokenScope): boolean {
  const scopes = scopesOf(variable);
  if (scopes === undefined || scopes.includes('ALL_SCOPES') || scopes.includes(scope)) return true;
  return FILL_SCOPES.has(scope) && scopes.includes('ALL_FILLS');
}

function matches(resolved: JsonValue | undefined, value: TokenValue): boolean {
  if (value.kind === 'FLOAT') return resolved === value.value;
  const rgba = rgbaOf(resolved);
  return (
    rgba !== undefined &&
    rgba.r === value.rgba.r &&
    rgba.g === value.rgba.g &&
    rgba.b === value.rgba.b &&
    Math.abs(rgba.a - value.rgba.a) < 1e-9
  );
}
