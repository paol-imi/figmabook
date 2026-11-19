import { describe, expect, it } from 'vitest';
import { FAULT_KINDS, faultPlan, healthyPlan, healthyShape, meetsExpectation, SLOW_LOADER_MS } from '../faults.ts';

describe('faultPlan', () => {
  const plan = faultPlan(200, 10);

  it('places 20 faults at index % 10 === 5, in kind order', () => {
    const faults = plan.filter((variant) => variant.fault !== null);
    expect(faults).toHaveLength(20);
    expect(faults.every((variant) => variant.index % 10 === 5)).toBe(true);
    expect(faults.slice(0, FAULT_KINDS.length).map((variant) => variant.fault)).toEqual(FAULT_KINDS);
  });

  it('makes the variant after each fault its recovery probe', () => {
    for (const variant of plan) {
      const previous = plan[variant.index - 1];
      expect(variant.recoveryOf).toBe(previous?.fault != null ? previous.index : null);
    }
  });

  it('re-renders the crashed story with crash: false after throws-args', () => {
    const crash = plan.find((variant) => variant.fault === 'throws-args');
    const after = plan[(crash?.index ?? 0) + 1];
    expect(crash?.args).toMatchObject({ crash: true });
    expect(after).toMatchObject({ storyId: crash?.storyId, args: { crash: false }, expect: { ok: true } });
  });

  it('expects the right outcome for each fault', () => {
    const byKind = Object.fromEntries(plan.filter((v) => v.fault !== null).map((v) => [v.fault, v.expect]));
    expect(byKind).toEqual({
      throws: { ok: false, code: 'SB_STORY_ERROR' },
      'throws-args': { ok: false, code: 'SB_STORY_ERROR' },
      'never-settles': { ok: false, code: 'SB_RENDER_TIMEOUT' },
      'slow-loader': { ok: true, minMs: SLOW_LOADER_MS },
      'console-error': { ok: true, warning: 'SB_CONSOLE_ERROR' },
      'play-fails': { ok: false, code: 'SB_PLAY_ERROR' },
      unstable: { ok: true, warning: 'CAP_UNSTABLE_RENDER' },
      'react-node-arg': { ok: true, selector: '[data-filled]' },
    });
    expect(plan.find((variant) => variant.fault === 'unstable')?.stability).toBe(true);
  });

  it('rejects bad sizes', () => {
    expect(() => faultPlan(0)).toThrow(RangeError);
    expect(() => faultPlan(10, 1)).toThrow(/spacing/);
  });
});

describe('healthy variants', () => {
  it('cycles four stories with distinct args', () => {
    expect(healthyShape(0).storyId).toBe('example-button--primary');
    expect(healthyShape(5).storyId).toBe('example-button--secondary');
    expect(healthyShape(6).args).toEqual({ label: 'Probe 6', tone: 'info' });
    expect(healthyShape(7).storyId).toBe('faults-slots--filled');
    const plan = healthyPlan(8);
    expect(new Set(plan.map((variant) => variant.label)).size).toBe(8);
    expect(plan[2]).toMatchObject({ index: 2, sid: 'faults-probe', globals: {} });
  });
});

describe('meetsExpectation', () => {
  const ok = { ok: true, warnings: [], ms: 10 } as const;

  it('matches error codes', () => {
    expect(meetsExpectation({ ok: false, code: 'SB_STORY_ERROR' }, { ...ok, ok: false, code: 'SB_STORY_ERROR' })).toBe(
      true,
    );
    expect(meetsExpectation({ ok: false, code: 'SB_STORY_ERROR' }, { ...ok, ok: false, code: 'SB_PLAY_ERROR' })).toBe(
      false,
    );
    expect(meetsExpectation({ ok: false, code: 'SB_STORY_ERROR' }, ok)).toBe(false);
  });

  it('checks warnings, minimum time and selectors of successful renders', () => {
    expect(meetsExpectation({ ok: true }, ok)).toBe(true);
    expect(meetsExpectation({ ok: true, warning: 'SB_CONSOLE_ERROR' }, ok)).toBe(false);
    expect(meetsExpectation({ ok: true, warning: 'SB_CONSOLE_ERROR' }, { ...ok, warnings: ['SB_CONSOLE_ERROR'] })).toBe(
      true,
    );
    expect(meetsExpectation({ ok: true, minMs: 100 }, ok)).toBe(false);
    expect(meetsExpectation({ ok: true, selector: 'b' }, { ...ok, selectorFound: true })).toBe(true);
    expect(meetsExpectation({ ok: true, selector: 'b' }, ok)).toBe(false);
    expect(meetsExpectation({ ok: true }, { ...ok, ok: false, code: 'SB_STORY_ERROR' })).toBe(false);
  });
});
