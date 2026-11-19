import { describe, expect, it } from 'vitest';
import { checkBudget, DEFAULT_BUDGET } from '../src';

describe('variant budgets (D-28)', () => {
  it('uses the README §5 defaults', () => {
    expect(DEFAULT_BUDGET).toEqual({ warn: 128, max: 256, hardLimit: 1024, maxProbes: 120 });
  });

  it.each([
    [1, 'ok'],
    [128, 'ok'],
    [129, 'warn'],
    [256, 'warn'],
    [257, 'over-max'],
    [1024, 'over-max'],
    [1025, 'over-hard-limit'],
  ] as const)('%i variants → %s', (count, status) => {
    expect(checkBudget(count)).toBe(status);
  });

  it('honours a custom budget', () => {
    expect(checkBudget(10, { ...DEFAULT_BUDGET, warn: 4, max: 8 })).toBe('over-max');
  });
});
