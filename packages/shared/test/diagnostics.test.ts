import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CAP_NONFINITE_VALUE,
  createDiagnostic,
  createDiagnosticRegistry,
  type DiagCode,
  type DiagnosticDef,
  defineDiagnostic,
  MAX_VALUE_LENGTH,
  PLAN_CONFIG_UNKNOWN_KEY,
  registry,
} from '../src';
import * as catalog from '../src/diagnostics';

const isDef = (value: unknown): value is DiagnosticDef =>
  typeof value === 'object' && value !== null && 'code' in value && 'remedy' in value;

describe('diagnostic catalog (12 §6)', () => {
  const defs = Object.entries(catalog).filter(([, value]) => isDef(value));

  it('registers every code it defines, under its own name', () => {
    expect(defs.length).toBeGreaterThan(0);
    for (const [name, def] of defs) {
      expect(isDef(def) && def.code).toBe(name);
      expect(registry.has(name)).toBe(true);
    }
    expect(registry.codes).toHaveLength(defs.length);
  });

  it('gives every code a plain-language message, a remedy and a docs page path', () => {
    for (const def of registry) {
      expect(def.message.length).toBeGreaterThan(10);
      expect(def.remedy.length).toBeGreaterThan(10);
      expect(def.docs).toBe(`/docs/diagnostics/${def.code}`);
      expect(def.code.startsWith(`${def.domain}_`)).toBe(true);
    }
  });

  it('types DiagCode as the union of registered codes', () => {
    expectTypeOf<'CAP_NONFINITE_VALUE'>().toExtend<DiagCode>();
    expectTypeOf<'CAP_NOT_A_CODE'>().not.toExtend<DiagCode>();
  });
});

describe('defineDiagnostic / createDiagnosticRegistry', () => {
  it('rejects codes outside the DOMAIN_UPPER_SNAKE format', () => {
    // @ts-expect-error unknown domain prefix
    expect(() => defineDiagnostic({ code: 'FOO_BAR', severity: 'info', message: 'm', remedy: 'r', since: '0.0.0' })).toThrow(TypeError);
    expect(() => defineDiagnostic({ code: 'CAP_lower', severity: 'info', message: 'm', remedy: 'r', since: '0.0.0' })).toThrow(TypeError);
  });

  it('rejects duplicate codes', () => {
    expect(() => createDiagnosticRegistry([CAP_NONFINITE_VALUE, CAP_NONFINITE_VALUE])).toThrow(/Duplicate/);
  });
});

describe('createDiagnostic', () => {
  it('renders the template and attaches the location', () => {
    const d = createDiagnostic(CAP_NONFINITE_VALUE, { value: 'NaN', pointer: '#/w' }, { nodeKey: 'root/label', variantKey: 'abc' });
    expect(d).toEqual({
      code: 'CAP_NONFINITE_VALUE',
      severity: 'error',
      message: 'A non-finite number (NaN) reached the IR at #/w.',
      nodeKey: 'root/label',
      variantKey: 'abc',
    });
  });

  it('requires exactly the template placeholders', () => {
    // @ts-expect-error missing the `pointer` param
    createDiagnostic(CAP_NONFINITE_VALUE, { value: 'NaN' });
    expectTypeOf(createDiagnostic(PLAN_CONFIG_UNKNOWN_KEY, { pointer: '/x' }).code).toEqualTypeOf<'PLAN_CONFIG_UNKNOWN_KEY'>();
  });

  it('uses the registered fallback and truncates long values', () => {
    const d = createDiagnostic(PLAN_CONFIG_UNKNOWN_KEY, { pointer: '/colr' }, { value: 'x'.repeat(500) });
    expect(d.fallback).toBe('the key was ignored');
    expect(d.value).toHaveLength(MAX_VALUE_LENGTH);
  });

  it('lets emitters raise severity, never lower it', () => {
    const args = { value: 'NaN', pointer: '#' };
    expect(createDiagnostic(CAP_NONFINITE_VALUE, args, { severity: 'fatal' }).severity).toBe('fatal');
    expect(() => createDiagnostic(CAP_NONFINITE_VALUE, args, { severity: 'warn' })).toThrow(RangeError);
  });
});
