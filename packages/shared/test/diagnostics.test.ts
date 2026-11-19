import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CAP_NONFINITE_VALUE,
  createDiagnostic,
  createDiagnosticRegistry,
  DIAGNOSTIC_CATALOG,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_DOMAIN_TITLES,
  DIAGNOSTIC_DOMAINS,
  DIAGNOSTIC_EMITTERS,
  type DiagCode,
  type DiagnosticCode,
  type DiagnosticDef,
  defineDiagnostic,
  diagnostic,
  isDiagnosticCode,
  MAX_VALUE_LENGTH,
  MESSAGE_TEMPLATES,
  PLAN_CONFIG_UNKNOWN_KEY,
  registry,
} from '../src';
import * as catalog from '../src/diagnostics/index';

const isDef = (value: unknown): value is DiagnosticDef =>
  typeof value === 'object' && value !== null && 'code' in value && 'remedy' in value;

describe('diagnostic catalog (12 §6.2)', () => {
  it('has unique codes, each in its own domain', () => {
    expect(new Set(DIAGNOSTIC_CODES).size).toBe(DIAGNOSTIC_CODES.length);
    expect(Object.keys(DIAGNOSTIC_CATALOG)).toEqual([...DIAGNOSTIC_CODES]);
    for (const code of DIAGNOSTIC_CODES) {
      const entry = DIAGNOSTIC_CATALOG[code];
      expect(entry.code).toBe(code);
      expect(code.startsWith(`${entry.domain}_`)).toBe(true);
      expect(code).toMatch(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/);
    }
  });

  it('gives every code a non-empty message, remedy, emitter and defining chapter', () => {
    for (const code of DIAGNOSTIC_CODES) {
      const entry = DIAGNOSTIC_CATALOG[code];
      expect(entry.message.trim(), code).not.toBe('');
      expect(entry.remedy.trim(), code).not.toBe('');
      expect(entry.remedy, code).toMatch(/[.!?:]$/);
      expect(entry.emittedBy.length, code).toBeGreaterThan(0);
      for (const emitter of entry.emittedBy) expect(DIAGNOSTIC_EMITTERS).toContain(emitter);
      expect(entry.definedIn.path, code).toMatch(/^internal\/plan\/\d\d-[a-z0-9-]+\.md$/);
      expect(['info', 'warn', 'error']).toContain(entry.severity);
    }
  });

  it('names every domain', () => {
    expect(Object.keys(DIAGNOSTIC_DOMAIN_TITLES)).toEqual([...DIAGNOSTIC_DOMAINS]);
    const used = new Set(DIAGNOSTIC_CODES.map((code) => DIAGNOSTIC_CATALOG[code].domain));
    expect([...used]).toEqual([...DIAGNOSTIC_DOMAINS]);
  });

  it('only has message templates for catalog codes', () => {
    for (const code of Object.keys(MESSAGE_TEMPLATES)) expect(isDiagnosticCode(code), code).toBe(true);
  });
});

describe('registry', () => {
  it('registers every catalog code, in catalog order', () => {
    expect(registry.codes).toEqual([...DIAGNOSTIC_CODES]);
    expect([...registry].map((def) => def.code)).toEqual([...DIAGNOSTIC_CODES]);
  });

  it('takes severity, remedy and metadata from the catalog', () => {
    for (const def of registry) {
      const entry = DIAGNOSTIC_CATALOG[def.code];
      expect(def.severity).toBe(entry.severity);
      expect(def.remedy).toBe(entry.remedy);
      expect(def.domain).toBe(entry.domain);
      expect(def.emittedBy).toEqual(entry.emittedBy);
      expect(def.definedIn).toEqual(entry.definedIn);
      expect(def.docs).toBe(`/docs/diagnostics/${def.code}`);
      expect(Object.isFrozen(def)).toBe(true);
    }
  });

  it('uses the message template when there is one, else the catalog meaning', () => {
    expect(diagnostic('SB_INDEX_UNREACHABLE').message).toBe(MESSAGE_TEMPLATES.SB_INDEX_UNREACHABLE.message);
    expect(diagnostic('SB_RENDER_TIMEOUT').message).toBe(DIAGNOSTIC_CATALOG.SB_RENDER_TIMEOUT.message);
    expect(PLAN_CONFIG_UNKNOWN_KEY.fallback).toBe('the key was ignored');
  });

  it('keeps the severity qualifier of the catalog', () => {
    expect(diagnostic('PLAN_COMPONENT_TOO_LARGE')).toMatchObject({ severity: 'warn', severityNote: 'error over 8 MB' });
  });

  it('keeps the named definitions of B-00 as registry entries', () => {
    const named = Object.entries(catalog).filter(([, value]) => isDef(value));
    expect(named.length).toBeGreaterThan(0);
    for (const [name, def] of named) {
      expect(isDef(def) && def.code).toBe(name);
      expect(registry.get(name)).toBe(def);
    }
  });

  it('diagnostic() returns the registry entry and rejects unknown codes at run time', () => {
    expect(diagnostic('CAP_NONFINITE_VALUE')).toBe(CAP_NONFINITE_VALUE);
    expect(() => diagnostic('CAP_NOT_A_CODE' as DiagnosticCode)).toThrow(/not.*catalog|add it to the catalog/);
  });

  it('isDiagnosticCode narrows strings', () => {
    expect(isDiagnosticCode('SB_RENDER_TIMEOUT')).toBe(true);
    expect(isDiagnosticCode('SB_NOT_A_CODE')).toBe(false);
  });

  it('types DiagnosticCode as the union of catalog codes', () => {
    expectTypeOf<'CAP_NONFINITE_VALUE'>().toExtend<DiagnosticCode>();
    expectTypeOf<'SB_RENDER_TIMEOUT'>().toExtend<DiagCode>();
    expectTypeOf<'CAP_NOT_A_CODE'>().not.toExtend<DiagnosticCode>();
    expectTypeOf<DiagCode>().toEqualTypeOf<DiagnosticCode>();
  });
});

describe('defineDiagnostic / createDiagnosticRegistry', () => {
  const spec = { severity: 'info', message: 'm', remedy: 'r', since: '0.0.0' } as const;

  it('rejects codes outside the catalog', () => {
    // @ts-expect-error unknown domain prefix
    expect(() => defineDiagnostic({ ...spec, code: 'FOO_BAR' })).toThrow(TypeError);
    // @ts-expect-error not a catalog code
    expect(() => defineDiagnostic({ ...spec, code: 'CAP_lower' })).toThrow(/catalog/);
  });

  it('derives the domain and docs path', () => {
    const def = defineDiagnostic({ ...spec, code: 'SB_RENDER_TIMEOUT' });
    expect(def).toMatchObject({ domain: 'SB', docs: '/docs/diagnostics/SB_RENDER_TIMEOUT' });
  });

  it('rejects duplicate codes', () => {
    expect(() => createDiagnosticRegistry([CAP_NONFINITE_VALUE, CAP_NONFINITE_VALUE])).toThrow(/Duplicate/);
  });
});

describe('createDiagnostic', () => {
  it('renders the template and attaches the location', () => {
    const d = createDiagnostic(
      CAP_NONFINITE_VALUE,
      { value: 'NaN', pointer: '#/w' },
      { nodeKey: 'root/label', variantKey: 'abc' },
    );
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
    expectTypeOf(
      createDiagnostic(PLAN_CONFIG_UNKNOWN_KEY, { pointer: '/x' }).code,
    ).toEqualTypeOf<'PLAN_CONFIG_UNKNOWN_KEY'>();
  });

  it('emits codes without a template with no params', () => {
    const d = createDiagnostic(diagnostic('SB_RENDER_TIMEOUT'), undefined, { sid: 'button' });
    expect(d).toEqual({
      code: 'SB_RENDER_TIMEOUT',
      severity: 'error',
      message: DIAGNOSTIC_CATALOG.SB_RENDER_TIMEOUT.message,
      sid: 'button',
    });
    expectTypeOf(createDiagnostic(diagnostic('SB_RENDER_TIMEOUT')).code).toEqualTypeOf<'SB_RENDER_TIMEOUT'>();
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
