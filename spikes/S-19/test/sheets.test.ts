import { describe, expect, it } from 'vitest';
import { dirname, normalizePath, toRepoPath } from '../resolver/paths.ts';
import {
  classifySheet,
  decodeDataUrl,
  documentPosition,
  isSourceMap,
  mapPosition,
  SheetTable,
} from '../resolver/sheets.ts';
import { BUTTON, header, range } from './support.ts';

describe('toRepoPath', () => {
  const options = { repoRoot: '/repo' };

  it('accepts files inside the repo in the forms Vite and source maps use', () => {
    expect(toRepoPath('/repo/src/a.css', options)).toEqual({ ok: true, path: 'src/a.css' });
    expect(toRepoPath('/repo/src/a.module.css?direct&used', options)).toEqual({ ok: true, path: 'src/a.module.css' });
    expect(toRepoPath('file:///repo/src/a%20b.css', options)).toEqual({ ok: true, path: 'src/a b.css' });
    expect(toRepoPath('/@fs/repo/src/a.css', options)).toEqual({ ok: true, path: 'src/a.css' });
    expect(toRepoPath('http://127.0.0.1:6006/@fs/repo/src/a.css', options)).toEqual({ ok: true, path: 'src/a.css' });
    expect(toRepoPath('http://127.0.0.1:6006/src/a.css', { ...options, viteRoot: '/repo/app' })).toEqual({
      ok: true,
      path: 'app/src/a.css',
    });
    expect(toRepoPath('a.css', { ...options, baseDir: '/repo/src/x' })).toEqual({ ok: true, path: 'src/x/a.css' });
  });

  it('handles Windows paths case-insensitively', () => {
    expect(toRepoPath('C:\\Repo\\src\\a.css', { repoRoot: 'c:/repo' })).toEqual({ ok: true, path: 'src/a.css' });
    expect(toRepoPath('file:///C:/Repo/src/a.css', { repoRoot: 'C:\\Repo' })).toEqual({ ok: true, path: 'src/a.css' });
  });

  it('rejects virtual modules, dependencies, escapes and unresolvable paths', () => {
    expect(toRepoPath('/repo/\0/iframe.html', options)).toEqual({ ok: false, reason: 'virtual' });
    expect(toRepoPath('virtual:x.css', options)).toEqual({ ok: false, reason: 'virtual' });
    expect(toRepoPath('/repo/node_modules/x/a.css', options)).toEqual({ ok: false, reason: 'dependency' });
    expect(toRepoPath('/repo/../etc/passwd', options)).toEqual({ ok: false, reason: 'outside-repo' });
    expect(toRepoPath('/repository/a.css', options)).toEqual({ ok: false, reason: 'outside-repo' });
    expect(toRepoPath('/repo', options)).toEqual({ ok: false, reason: 'outside-repo' });
    expect(toRepoPath('src/a.css', options)).toEqual({ ok: false, reason: 'unresolvable' });
    expect(toRepoPath('http://127.0.0.1:6006/src/a.css', options)).toEqual({ ok: false, reason: 'unresolvable' });
  });

  it('normalizes paths', () => {
    expect(normalizePath('/a/./b/../c//d')).toBe('/a/c/d');
    expect(normalizePath('a/../../b')).toBe('../b');
    expect(normalizePath('C:\\x\\..\\y')).toBe('c:/y');
    expect(dirname('/a/b/c.css')).toBe('/a/b');
    expect(dirname('/c.css')).toBe('/');
  });
});

describe('decodeDataUrl / isSourceMap', () => {
  it('decodes base64 and percent-encoded JSON', () => {
    const json = JSON.stringify({ version: 3, sources: ['ü.css'], mappings: 'AAAA' });
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
    expect(decodeDataUrl(`data:application/json;charset=utf-8;base64,${base64}`)).toEqual(JSON.parse(json));
    expect(decodeDataUrl(`data:application/json,${encodeURIComponent(json)}`)).toEqual(JSON.parse(json));
    expect(decodeDataUrl('data:application/json;base64,%%%')).toBeUndefined();
    expect(decodeDataUrl('https://example.test/a.map')).toBeUndefined();
  });

  it('accepts v3 maps only', () => {
    expect(isSourceMap({ version: 3, sources: [], mappings: '' })).toBe(true);
    expect(isSourceMap({ version: 3, sections: [] })).toBe(false);
    expect(isSourceMap(null)).toBe(false);
  });
});

describe('classifySheet / mapPosition', () => {
  const options = { repoRoot: '/repo' };
  const map = {
    version: 3 as const,
    sources: ['/repo/src/a.css'],
    names: [],
    mappings: 'AAAA;EACE',
    sourcesContent: ['.a {\n  color: red;\n}'],
  };

  it('classifies sheets by what they carry', () => {
    expect(classifySheet({ header: header('1'), sourceMap: map }, options).kind).toBe('source-mapped');
    expect(classifySheet({ header: header('2'), devId: '/repo/src/a.css' }, options).kind).toBe('dev-id');
    expect(classifySheet({ header: header('3', { sourceURL: 'http://127.0.0.1:1/assets/a.css' }) }, options).kind).toBe(
      'built',
    );
    expect(
      classifySheet({ header: header('4', { isInline: true, sourceURL: 'http://127.0.0.1:1/iframe.html' }) }, options)
        .kind,
    ).toBe('unmapped');
    expect(classifySheet({ header: header('5', { origin: 'user-agent' }) }, options).kind).toBe('user-agent');
  });

  it('maps exact and verbatim-offset positions through the map, 1-based', () => {
    const sheet = classifySheet({ header: header('1'), devId: '/repo/src/a.css', sourceMap: map }, options);
    expect(mapPosition(sheet, { line: 1, column: 2 }, options)).toMatchObject({
      ok: true,
      loc: { file: 'src/a.css', line: 2, col: 3 },
      exact: true,
      approximate: false,
      content: '.a {\n  color: red;\n}',
    });
    expect(mapPosition(sheet, { line: 1, column: 9 }, options)).toMatchObject({
      loc: { line: 2, col: 10 },
      exact: false,
    });
    expect(mapPosition(sheet, { line: 5, column: 0 }, options)).toEqual({ ok: false, reason: 'no-segment' });
  });

  it('resolves relative sources against the dev id and validates them', () => {
    const relative = { ...map, sources: ['a.css'], sourceRoot: '' };
    const sheet = classifySheet({ header: header('1'), devId: '/repo/src/a.css?used', sourceMap: relative }, options);
    expect(mapPosition(sheet, { line: 0, column: 0 }, options)).toMatchObject({ loc: { file: 'src/a.css' } });
    const outside = classifySheet(
      { header: header('2'), sourceMap: { ...map, sources: ['/elsewhere/a.css'] } },
      options,
    );
    expect(mapPosition(outside, { line: 0, column: 0 }, options)).toEqual({ ok: false, reason: 'outside-repo' });
  });

  it('gives the reasons of unmapped sheets', () => {
    const built = classifySheet({ header: header('3', { sourceURL: 'http://127.0.0.1:1/a.css' }) }, options);
    expect(mapPosition(built, { line: 0, column: 0 }, options)).toEqual({ ok: false, reason: 'minified' });
    const inline = classifySheet({ header: header('4') }, options);
    expect(mapPosition(inline, { line: 0, column: 0 }, options)).toEqual({ ok: false, reason: 'no-sourcemap' });
    const ua = classifySheet({ header: header('5', { origin: 'user-agent' }) }, options);
    expect(mapPosition(ua, { line: 0, column: 0 }, options)).toEqual({ ok: false, reason: 'user-agent' });
    const devId = classifySheet({ header: header('6'), devId: '/repo/node_modules/x.css' }, options);
    expect(mapPosition(devId, { line: 0, column: 0 }, options)).toEqual({ ok: false, reason: 'dependency' });
  });

  it('places a sheet-relative position in its document', () => {
    const inline = header('1', { isInline: true, startLine: 69, startColumn: 7 });
    expect(documentPosition(inline, { line: 0, column: 2 })).toEqual({ line: 69, column: 9 });
    expect(documentPosition(inline, { line: 48, column: 2 })).toEqual({ line: 117, column: 2 });
  });
});

describe('SheetTable on the recorded dev-server sheets', () => {
  const table = new SheetTable(BUTTON.sheets, { repoRoot: BUTTON.repoRoot });

  it('classifies Vite module sheets as source-mapped and Storybook preview sheets as unmapped', () => {
    const kinds = [...table.values()].map((sheet) => [sheet.devId?.replace(/^.*\/src\//, 'src/') ?? '', sheet.kind]);
    expect(kinds.filter(([, kind]) => kind === 'source-mapped').map(([file]) => file)).toEqual(
      expect.arrayContaining([
        'src/tokens/tokens.css',
        'src/components/Button/Button.module.css',
        'src/styles/base.css',
      ]),
    );
    expect(kinds.some(([, kind]) => kind === 'unmapped')).toBe(true);
    expect(table.size).toBe(BUTTON.sheets.length);
  });

  it('treats an unknown sheet or a missing range as unmapped', () => {
    expect(table.map('nope', range(0, 0))).toEqual({ ok: false, reason: 'no-sourcemap' });
    expect(table.map(undefined, undefined)).toEqual({ ok: false, reason: 'no-sourcemap' });
  });
});
