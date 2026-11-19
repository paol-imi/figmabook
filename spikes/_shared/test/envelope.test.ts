import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  buildEnvelope,
  detectClient,
  ENVELOPE_FORMAT,
  joinParts,
  resultFileName,
  splitIntoParts,
} from '../envelope.ts';
import { errorMessage, round3 } from '../json.ts';
import { FailedEnvelope } from '../schema.ts';

const env = { apiVersion: '1.0.0', editorType: 'figma', client: 'desktop', os: 'macos' } as const;

describe('result envelope (BUILD §9.1)', () => {
  it('has exactly the documented fields, in order', () => {
    const envelope = buildEnvelope({
      spike: 'S-06',
      kitVersion: '0.1.0',
      step: 'step1',
      status: 'done',
      env,
      results: { a: 1 },
    });
    expect(Object.keys(envelope)).toEqual(['format', 'spike', 'kitVersion', 'step', 'status', 'env', 'results']);
    expect(envelope.format).toBe(ENVELOPE_FORMAT);
  });

  it('a failed envelope carries only the error text', () => {
    const envelope = buildEnvelope({
      spike: 'S-02',
      kitVersion: '0.1.0',
      step: 'step2',
      status: 'failed',
      env,
      results: { error: 'boom' },
    });
    expect(Value.Check(FailedEnvelope, envelope)).toBe(true);
  });
});

describe('detectClient', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Figma/125.1.5 Chrome/130.0 Safari/537.36',
      'desktop',
      'macos',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Figma/125.1.5 Chrome/130.0',
      'desktop',
      'windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'browser',
      'macos',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'browser', 'linux'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/130.0', 'browser', 'chromeos'],
    ['', 'unknown', 'other'],
  ])('%s → %s on %s', (userAgent, client, os) => {
    expect(detectClient(userAgent)).toEqual({ client, os });
  });
});

describe('splitIntoParts / joinParts', () => {
  const label = { spike: 'S-02', step: 'step3' };

  it('keeps a small result as one unchanged part', () => {
    expect(splitIntoParts('{"a":1}', label)).toEqual(['{"a":1}']);
    expect(joinParts(['{"a":1}'])).toBe('{"a":1}');
  });

  it('splits on the byte limit without cutting characters, and joins in any order', () => {
    const text = JSON.stringify({ text: 'Größe ✓ 日本 😀 '.repeat(400) });
    const parts = splitIntoParts(text, label, 1000);
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) {
      const body = part.slice(part.indexOf('\n') + 1);
      expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(1000);
    }
    expect(parts[0]).toMatch(new RegExp(`^HOLOTYPE-SPIKE-PART S-02 step3 1/${parts.length}\\n`));
    expect(joinParts([...parts].reverse())).toBe(text);
  });

  it('refuses an incomplete set of parts with a clear message', () => {
    const parts = splitIntoParts('x'.repeat(3000), label, 1000);
    expect(() => joinParts(parts.slice(1))).toThrow(/Expected parts 1…3, got 2, 3/);
    expect(() => joinParts(['no header', 'either'])).toThrow(/HOLOTYPE-SPIKE-PART/);
  });
});

describe('helpers', () => {
  it('names result files by spike and step only', () => {
    expect(resultFileName('S-02', 'step3')).toBe('holotype-s-02-step3.json');
    expect(resultFileName('S-02', 'step3', { index: 2, total: 3 })).toBe('holotype-s-02-step3-part2of3.json');
  });

  it('turns any thrown value into a message without a stack', () => {
    expect(errorMessage(new Error('bad'))).toBe('bad');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('rounds to 1/1000', () => {
    expect(round3(1.23456)).toBe(1.235);
    expect(round3(-0.0004)).toBe(-0);
  });
});
