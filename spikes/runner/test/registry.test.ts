import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { spikes } from '../src/registry.ts';
import { allTasks } from '../src/tasks.ts';

const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');

describe('spike registry', () => {
  it('lists the slice-gating spikes of BUILD §9.4, in order', () => {
    expect(spikes.map((spike) => spike.id)).toEqual(['S-02', 'S-05', 'S-06', 'S-12', 'S-16', 'S-17']);
  });

  it('gives every step a unique id and plain, short instructions', () => {
    for (const spike of spikes) {
      expect(new Set(spike.steps.map((step) => step.id)).size, spike.id).toBe(spike.steps.length);
      for (const step of spike.steps) {
        for (const line of [...(step.before ?? []), ...(step.after ?? []), step.where]) {
          expect(line.length, `${spike.id} ${step.id}: ${line}`).toBeLessThanOrEqual(140);
        }
      }
    }
  });

  it('namespaces every main task by its spike', () => {
    const prefixes = new Set(['kit', ...spikes.map((spike) => spike.id)]);
    for (const task of Object.keys(allTasks)) expect(prefixes.has(task.split('/')[0] ?? ''), task).toBe(true);
  });

  it('has a user card in the README for every spike and step', () => {
    for (const spike of spikes) {
      expect(readme, spike.id).toContain(`${spike.id} · ${spike.title}`);
      for (const step of spike.steps) expect(readme, `${spike.id} ${step.label}`).toContain(step.label);
    }
  });
});
