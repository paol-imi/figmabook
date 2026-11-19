import { describe, expect, it } from 'vitest';
import {
  bindAnswers,
  branchSlug,
  type ChainLink,
  checkDcrVersion,
  type DcrAnswers,
  type DcrScope,
  type DesignChangeRequest,
  formatDcrScope,
  latestPointerName,
  parseDcrScope,
  REQUESTS_DIR,
  resolveChain,
} from '../src';
import { validDoc } from './corpus';

describe('DcrScope string form (15 §4.6, 16 §15)', () => {
  it.each<[string, DcrScope]>([
    ['changed', { kind: 'changed' }],
    ['ready', { kind: 'ready' }],
    ['all', { kind: 'all' }],
    ['page:Checkout / Mobile', { kind: 'page', name: 'Checkout / Mobile' }],
    ['selection:60:2, 12:40,60:2', { kind: 'selection', ids: ['12:40', '60:2'] }],
  ])('parses %j', (input, scope) => {
    const result = parseDcrScope(input);
    expect(result).toEqual({ ok: true, value: scope });
    if (result.ok) expect(parseDcrScope(formatDcrScope(result.value))).toEqual(result);
  });

  it.each([
    ['page:', 'needs a page name'],
    ['selection:', 'at least one node id'],
    ['selection:12-40', '"12-40" is not a Figma node id'],
    ['everything', 'Unknown scope "everything"'],
  ])('rejects %j with a plain message', (input, message) => {
    const result = parseDcrScope(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it('formats selections sorted and unique', () => {
    expect(formatDcrScope({ kind: 'selection', ids: ['60:2', '12:40', '60:2'] })).toBe('selection:12:40,60:2');
  });
});

describe('LATEST pointer (D-56)', () => {
  it('names the pointer file by branch slug', () => {
    expect(REQUESTS_DIR).toBe('.holotype/requests');
    expect(latestPointerName('feat/price-tag')).toBe('LATEST-feat-price-tag');
    expect(branchSlug('fix/über café')).toBe('fix-_ber_caf_');
    expect(branchSlug('.hidden/x')).toBe('hidden-x');
  });

  it('rejects a branch with no file-name-safe characters', () => {
    expect(() => branchSlug('...')).toThrow(/no file-name-safe characters/);
  });
});

describe('resolveChain (parent links, D-56)', () => {
  const link = (id: string, parent?: string, branch = 'feat/x'): ChainLink => ({
    id,
    header: parent === undefined ? { branch } : { branch, parent },
  });

  it('orders requests oldest first and returns the newest', () => {
    const result = resolveChain([link('c', 'b'), link('a'), link('b', 'a')], 'feat/x');
    expect(result.ok && result.value.chain.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(result.ok && result.value.latest.id).toBe('c');
  });

  it('starts at a pruned parent', () => {
    const result = resolveChain([link('c', 'b'), link('b', 'pruned')], 'feat/x');
    expect(result.ok && result.value.chain.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it.each<[string, ChainLink[], string]>([
    ['empty', [], 'No request found'],
    ['other branch', [link('a', undefined, 'feat-x')], 'belongs to branch "feat-x"'],
    ['duplicate', [link('a'), link('a')], 'appears twice'],
    ['fork', [link('a'), link('b', 'a'), link('c', 'a')], 'the chain forks'],
    ['two chains', [link('a'), link('b')], '2 separate request chains'],
    ['cycle', [link('a', 'b'), link('b', 'a')], 'form a cycle'],
    ['cycle beside a chain', [link('r'), link('a', 'b'), link('b', 'a')], 'form a cycle'],
  ])('fails on %s', (_name, requests, message) => {
    const result = resolveChain(requests, 'feat/x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});

describe('bindAnswers (D-56)', () => {
  const dcr = validDoc('dcr', 'worked-example.json') as DesignChangeRequest;
  const answers = validDoc('answers', 'worked-example.json') as DcrAnswers;

  it('applies answers given for this dcrHash', () => {
    expect(bindAnswers(dcr, answers)).toEqual({
      state: 'current',
      byQuestion: { q1: '--radius-md', q2: 'extend Badge' },
      unknownQuestions: [],
    });
  });

  it('lists answers to questions the request does not ask', () => {
    const byQuestion = JSON.parse('{"q1":"--radius-md","q9":"x","__proto__":"y"}') as Record<string, string>;
    expect(bindAnswers(dcr, { ...answers, byQuestion })).toEqual({
      state: 'current',
      byQuestion: { q1: '--radius-md' },
      unknownQuestions: ['__proto__', 'q9'],
    });
  });

  it('treats answers for another hash as stale, like approval (D-44)', () => {
    expect(bindAnswers(dcr, { ...answers, dcrHash: '0000000000000000' })).toEqual({
      state: 'stale',
      answeredHash: '0000000000000000',
    });
  });
});

describe('checkDcrVersion', () => {
  it('reads major 1 and rejects others with APPLY_IR_VERSION_UNSUPPORTED', () => {
    expect(checkDcrVersion('1.4.0')).toBeUndefined();
    expect(checkDcrVersion('2.0.0')).toMatchObject({
      code: 'APPLY_IR_VERSION_UNSUPPORTED',
      message: expect.stringContaining('DCR version 2.0.0'),
    });
    expect(checkDcrVersion(undefined)?.message).toContain('version unknown');
  });
});
