import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSUMPTION_IDS, ASSUMPTIONS } from '../src';
import { AssumptionLog } from '../src/assumptions';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const FIGMA_DOCS = /^https:\/\/(developers\.figma\.com\/docs\/plugins\/api\/|help\.figma\.com\/hc\/en-us\/articles\/)/;

describe('ASSUMPTIONS', () => {
  it.each(ASSUMPTION_IDS.map((id) => [id, ASSUMPTIONS[id]] as const))('%s cites Figma docs', (_id, assumption) => {
    expect(assumption.rule.length).toBeGreaterThan(20);
    expect(assumption.sources.length).toBeGreaterThan(0);
    for (const source of assumption.sources) expect(source).toMatch(FIGMA_DOCS);
  });

  it('names a spike exactly for the spike-gated rules', () => {
    for (const id of ASSUMPTION_IDS) {
      const { status, spike } = ASSUMPTIONS[id];
      expect(spike !== undefined, id).toBe(status === 'spike');
    }
  });

  it('marks the S-04, S-05 and S-10 rules', () => {
    const bySpike = (spike: string) => ASSUMPTION_IDS.filter((id) => ASSUMPTIONS[id].spike === spike);
    expect(bySpike('S-04')).toEqual(['baseline-alignment', 'baseline-synthesized', 'baseline-fill']);
    expect(bySpike('S-05')).toEqual(['stroke-included-per-side', 'stroke-included-center-outside']);
    expect(bySpike('S-10')).toEqual(['auto-gap-evenly-around']);
  });

  it.each(ASSUMPTION_IDS)('%s is documented in the README with its status', (id) => {
    const { status, spike } = ASSUMPTIONS[id];
    const row = readme.split('\n').find((line) => new RegExp(`^\\| \`${id}\` +\\|`).test(line));
    expect(row, `README row for ${id}`).toBeDefined();
    expect(row).toContain(spike ?? status);
  });
});

describe('AssumptionLog', () => {
  it('lists only unconfirmed rules, once each, in catalog order', () => {
    const log = new AssumptionLog();
    log.use('fill-no-space');
    log.use('padding');
    log.use('auto-gap-evenly-around');
    log.use('fill-no-space');
    log.use('fill-equal-share');
    expect(log.list()).toEqual(['fill-equal-share', 'fill-no-space', 'auto-gap-evenly-around']);
  });
});
