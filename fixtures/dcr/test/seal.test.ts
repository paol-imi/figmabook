import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DesignChangeRequest, FigmaSnapshot } from '@holotype/dcr';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CASE_FILES,
  CaseFileError,
  caseDir,
  checkCaseInput,
  FIXTURES_ROOT,
  loadCase,
  loadCaseInput,
  parsePromptGolden,
  pendingPrompt,
  requestBytes,
  sealCase,
} from '../src/index.ts';

/* `seal` derives ids, hashes and counts, so authors only edit meaning. Tests run on a temp copy. */

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function copyCase(name: string): URL {
  const root = mkdtempSync(join(tmpdir(), 'fixture-dcr-'));
  roots.push(root);
  cpSync(new URL(`${name}/`, FIXTURES_ROOT), join(root, name), { recursive: true });
  return pathToFileURL(`${root}/`);
}
const readJson = <T>(root: URL, name: string, file: string): T =>
  JSON.parse(readFileSync(new URL(file, caseDir(name, root)), 'utf8')) as T;
const writeJson = (root: URL, name: string, file: string, value: unknown) =>
  writeFileSync(new URL(file, caseDir(name, root)), `${JSON.stringify(value, null, 2)}\n`);

describe('sealCase', () => {
  it('leaves a sealed case alone', () => {
    const root = copyCase('modified-padding');
    expect(sealCase('modified-padding', root)).toEqual([]);
  });

  it('turns a draft (placeholder ids, stale counts and hashes) into the golden', () => {
    const name = 'component-new';
    const root = copyCase(name);
    const golden = loadCase(name).expected.dcr;
    const draft = readJson<DesignChangeRequest>(root, name, CASE_FILES.dcr);
    const [item] = draft.items;
    if (!item) throw new Error('component-new has an item');
    const placeholder = '0000000000000001';
    const text = JSON.stringify(draft).replaceAll(item.id, placeholder);
    const stale = JSON.parse(text) as DesignChangeRequest;
    stale.summary.counts = {};
    stale.summary.questions = 0;
    stale.header.figma.snapshotHash = '0000000000000000';
    stale.header.extractor.configHash = '0000000000000000';
    stale.header.generated = { at: '2026-11-19T10:00:00.000Z', by: 'plugin' };
    stale.dcrHash = '0000000000000000';
    writeJson(root, name, CASE_FILES.dcr, stale);

    expect(sealCase(name, root)).toEqual([CASE_FILES.dcr]);
    const sealed = loadCase(name, root).expected.dcr;
    expect(requestBytes(sealed)).toBe(requestBytes(golden));
    expect(sealed.questions.every((q) => q.itemId === item.id)).toBe(true);
    expect(sealed.items[0]?.assets.after).toBe(`${item.id}:after`);
  });

  it('derives the applied hashes of managed nodes from the baselines', () => {
    const name = 'modified-color';
    const root = copyCase(name);
    const branch = readJson<FigmaSnapshot>(root, name, CASE_FILES.branch);
    const [id, node] = Object.entries(branch.nodes).find(([, n]) => n.data.nk === 'root/label') ?? [];
    if (!id || !node) throw new Error('modified-color has a label');
    node.data.ah = '0'.repeat(112);
    writeJson(root, name, CASE_FILES.branch, branch);
    expect(checkCaseInput(loadCaseInput(caseDir(name, root)))).toContain(
      `${id}: data.ah is not the applied hash of its baseline groups.`,
    );
    expect(sealCase(name, root)).toEqual([CASE_FILES.branch]);
    expect(checkCaseInput(loadCaseInput(caseDir(name, root)))).toEqual([]);
  });

  it('writes the pending prompt placeholder when the prompt golden is missing', () => {
    const name = 'no-change';
    const root = copyCase(name);
    rmSync(new URL(CASE_FILES.prompt, caseDir(name, root)));
    expect(sealCase(name, root)).toEqual([CASE_FILES.prompt]);
    expect(loadCase(name, root).expected.prompt).toEqual({ pending: true, reason: 'B-67 renderPrompt' });
  });

  it('refuses a request that fails the integrity check', () => {
    const name = 'modified-radius';
    const root = copyCase(name);
    const draft = readJson<DesignChangeRequest>(root, name, CASE_FILES.dcr);
    draft.questions.push({ id: 'q9', itemId: 'ffffffffffffffff', code: 'DCR_VALUE_NO_TOKEN', text: 'Dangling?' });
    writeJson(root, name, CASE_FILES.dcr, draft);
    expect(() => sealCase(name, root)).toThrow(/No item has id ffffffffffffffff/);
  });
});

describe('case loading', () => {
  it('reports every schema issue of a broken file, with its path', () => {
    const name = 'unknown';
    const root = copyCase(name);
    const branch = readJson<Record<string, unknown>>(root, name, CASE_FILES.branch);
    branch.source = 'clipboard';
    writeJson(root, name, CASE_FILES.branch, branch);
    let error: unknown;
    try {
      loadCase(name, root);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CaseFileError);
    expect((error as CaseFileError).file).toMatch(/unknown\/branch\.json$/);
    expect((error as CaseFileError).issues.map((i) => i.path)).toContain('/source');
  });

  it('parses prompt goldens: the pending placeholder or the text', () => {
    expect(parsePromptGolden(pendingPrompt('x'))).toEqual({ pending: true, reason: 'B-67 renderPrompt' });
    expect(parsePromptGolden('## Review summary\n')).toEqual({ pending: false, text: '## Review summary\n' });
  });
});
