import { describe, expect, it } from 'vitest';
import { ProvenanceDiagnostics } from '../resolver/diagnostics.ts';
import { relevantFields } from '../resolver/fields.ts';
import { dehashSelector, resolveField, resolveNodeFields, toFieldOrigin } from '../resolver/resolve.ts';
import { SheetTable } from '../resolver/sheets.ts';
import { BUTTON, decl, header, matched, rule } from './support.ts';

const BUTTON_CSS = 'fixtures/ds-react/src/components/Button/Button.module.css';
const TOKENS_CSS = 'fixtures/ds-react/src/tokens/tokens.css';

describe('resolveField on the recorded components-button--primary', () => {
  const sheets = new SheetTable(BUTTON.sheets, { repoRoot: BUTTON.repoRoot });
  const ctx = { sheets };
  const { button, label } = BUTTON.nodes;

  it('maps padding-left to the `.md` padding-inline declaration and its token', () => {
    const field = resolveField(button.matched, 'padding-left', button.computed, ctx);
    expect(field).toMatchObject({
      status: 'resolved',
      computed: '16px',
      declaration: { name: 'padding-inline', value: 'var(--space-4)', source: 'rule', level: 0 },
      selector: { original: '.md' },
      rule: { file: BUTTON_CSS, line: 67, col: 3 },
      exact: true,
      sheetKind: 'source-mapped',
      valueCheck: 'match',
    });
    expect(field.selector?.served).toMatch(/^\._md_[a-z0-9]{5}_\d+$/);
    expect(field.varChain).toMatchObject({
      names: ['--space-4'],
      terminal: '16px',
      pure: true,
      status: 'complete',
      definitions: [
        { name: '--space-4', selector: { original: ':root' }, loc: { file: TOKENS_CSS, line: 61, col: 3 } },
      ],
    });
  });

  it('follows background-color through --button-bg → --color-primary → --color-blue-600', () => {
    const field = resolveField(button.matched, 'background-color', button.computed, ctx);
    expect(field.rule).toEqual({ file: BUTTON_CSS, line: 21, col: 3 });
    expect(field.selector?.original).toBe('.primary');
    expect(field.varChain?.names).toEqual(['--button-bg', '--color-primary', '--color-blue-600']);
    expect(field.varChain?.definitions.map((d) => d.loc?.line)).toEqual([148, 125, 34]);
    expect(field.valueCheck).toBe('match');
  });

  it('picks the var() of a `border` shorthand that explains border-top-width', () => {
    const field = resolveField(button.matched, 'border-top-width', button.computed, ctx);
    expect(field.declaration?.name).toBe('border');
    expect(field.varChain?.names).toEqual(['--border-width-1']);
    expect(field.rule).toEqual({ file: BUTTON_CSS, line: 5, col: 3 });
  });

  it('resolves inherited typography on the label from the button rule', () => {
    const field = resolveField(label.matched, 'font-size', label.computed, ctx);
    expect(field).toMatchObject({
      status: 'resolved',
      declaration: { name: 'font-size', level: 1 },
      selector: { original: '.md' },
      rule: { file: BUTTON_CSS, line: 68, col: 3 },
    });
    expect(field.varChain?.names).toEqual(['--font-size-sm']);
    const family = resolveField(label.matched, 'font-family', label.computed, ctx);
    expect(family.selector?.original).toBe('.button');
    expect(family.varChain?.terminal).toBe('"Inter", sans-serif');
  });

  it('reports user-agent padding as unresolved', () => {
    const field = resolveField(button.matched, 'padding-top', button.computed, ctx);
    expect(field).toMatchObject({ status: 'unresolved', reason: 'user-agent', computed: '1px' });
  });

  it('resolves every relevant field of the button and the label without a sheet diagnostic', () => {
    const diagnostics = new ProvenanceDiagnostics();
    const fields = [
      ...resolveNodeFields(
        button.matched,
        button.computed,
        relevantFields('element', button.computed),
        ctx,
        diagnostics,
      ),
      ...resolveNodeFields(label.matched, label.computed, relevantFields('text', label.computed), ctx, diagnostics),
    ];
    const summary = fields.map((f) => `${f.property}:${f.status}${f.reason === undefined ? '' : `(${f.reason})`}`);
    expect(summary).toMatchInlineSnapshot(`
      [
        "padding-top:unresolved(user-agent)",
        "padding-right:resolved",
        "padding-bottom:unresolved(user-agent)",
        "padding-left:resolved",
        "row-gap:resolved",
        "column-gap:resolved",
        "background-color:resolved",
        "border-top-width:resolved",
        "border-right-width:resolved",
        "border-bottom-width:resolved",
        "border-left-width:resolved",
        "border-top-left-radius:resolved",
        "border-top-right-radius:resolved",
        "border-bottom-right-radius:resolved",
        "border-bottom-left-radius:resolved",
        "color:resolved",
        "font-family:resolved",
        "font-size:resolved",
        "font-weight:resolved",
        "line-height:resolved",
      ]
    `);
    expect(fields.filter((f) => f.valueCheck === 'mismatch')).toEqual([]);
    expect(diagnostics.list).toEqual([]);
  });

  it('converts to a FieldOrigin (15 §5.2)', () => {
    const field = resolveField(button.matched, 'padding-left', button.computed, ctx);
    expect(toFieldOrigin(field, ['border-left-width', 'padding-left'])).toEqual({
      css: ['border-left-width', 'padding-left'],
      authored: 'var(--space-4)',
      selector: '.md',
      rule: { file: BUTTON_CSS, line: 67, col: 3 },
      varChain: ['--space-4'],
    });
  });
});

describe('resolveField on synthetic styles', () => {
  const repoRoot = '/repo';
  const devId = '/repo/src/Box.module.css';

  it('marks a dev-id sheet without a map as approximate, with the served line', () => {
    const sheets = new SheetTable([{ header: header('s1'), devId }], { repoRoot });
    const styles = matched([rule('._box_ab12c_1', [decl('padding-left', '4px', 3)])]);
    const field = resolveField(styles, 'padding-left', { 'padding-left': '4px' }, { sheets });
    expect(field).toMatchObject({
      status: 'approximate',
      rule: { file: 'src/Box.module.css', line: 4, col: 3 },
      selector: { served: '._box_ab12c_1', original: '.box' },
      valueCheck: 'match',
    });
  });

  it('gives built CSS selector-only provenance', () => {
    const sheets = new SheetTable([{ header: header('s1', { sourceURL: 'http://127.0.0.1:1/assets/a.css' }) }], {
      repoRoot,
    });
    const field = resolveField(matched([rule('.a', [decl('color', 'red')])]), 'color', undefined, { sheets });
    expect(field.status).toBe('selector-only');
    expect(field.rule).toBeUndefined();
  });

  it('reports a sheet with neither map nor file as no-sourcemap', () => {
    const sheets = new SheetTable([{ header: header('s1') }], { repoRoot });
    const field = resolveField(matched([rule('.a', [decl('color', 'red')])]), 'color', undefined, { sheets });
    expect(field).toMatchObject({ status: 'unresolved', reason: 'no-sourcemap', sheetKind: 'unmapped' });
  });

  it('reports style="" and undeclared properties', () => {
    const sheets = new SheetTable([], { repoRoot });
    const inline = resolveField(
      { inlineStyle: { cssProperties: [decl('color', 'red')] } },
      'color',
      { color: 'rgb(255, 0, 0)' },
      { sheets },
    );
    expect(inline).toMatchObject({ status: 'unresolved', reason: 'inline-style', valueCheck: 'unknown' });
    expect(resolveField({}, 'padding-left', undefined, { sheets })).toMatchObject({ reason: 'not-declared' });
    const keyword = resolveField(matched([rule('.a', [decl('padding-left', 'initial')])]), 'padding-left', undefined, {
      sheets,
    });
    expect(keyword.reason).toBe('css-wide-keyword');
  });

  it('marks a multi-var() longhand value as ambiguous', () => {
    const sheets = new SheetTable([{ header: header('s1'), devId }], { repoRoot });
    const styles = matched([
      rule('.a', [decl('padding-left', 'calc(var(--a) + var(--b))'), decl('--a', '1px', 1), decl('--b', '2px', 2)]),
    ]);
    const field = resolveField(styles, 'padding-left', { 'padding-left': '3px' }, { sheets });
    expect(field.varChain?.status).toBe('ambiguous');
    expect(field.valueCheck).toBe('unknown');
  });

  it('uses the positional component of a box shorthand', () => {
    const sheets = new SheetTable([{ header: header('s1'), devId }], { repoRoot });
    const styles = matched([rule('.a', [decl('padding', '2px var(--x)'), decl('--x', '6px', 1)])]);
    const left = resolveField(styles, 'padding-left', { 'padding-left': '6px' }, { sheets });
    expect(left.varChain?.names).toEqual(['--x']);
    expect(left.valueCheck).toBe('match');
    const top = resolveField(styles, 'padding-top', { 'padding-top': '2px' }, { sheets });
    expect(top.varChain).toBeUndefined();
    expect(top.valueCheck).toBe('match');
  });

  it('flags a winner that does not explain the computed value', () => {
    const sheets = new SheetTable([{ header: header('s1'), devId }], { repoRoot });
    const field = resolveField(
      matched([rule('.a', [decl('padding-left', '4px')])]),
      'padding-left',
      {
        'padding-left': '5px',
      },
      { sheets },
    );
    expect(field.valueCheck).toBe('mismatch');
  });

  it('matches a literal component of a non-positional shorthand', () => {
    const sheets = new SheetTable([{ header: header('s1'), devId }], { repoRoot });
    const styles = matched([rule('.a', [decl('border', '2px dashed #475569')])]);
    const field = resolveField(styles, 'border-top-color', { 'border-top-color': 'rgb(71, 85, 105)' }, { sheets });
    expect(field.valueCheck).toBe('match');
    expect(field.varChain).toBeUndefined();
  });
});

describe('dehashSelector', () => {
  it("strips Vite's dev CSS-module class pattern", () => {
    expect(dehashSelector('._button_xefp9_1:disabled')).toBe('.button:disabled');
    expect(dehashSelector('._primary_xefp9_20:hover:not(:disabled)')).toBe('.primary:hover:not(:disabled)');
    expect(dehashSelector('._card_oasze_1 > ._media_oasze_12')).toBe('.card > .media');
    expect(dehashSelector('.plain-class, button')).toBe('.plain-class, button');
  });
});
