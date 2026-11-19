import { readdirSync, readFileSync } from 'node:fs';
import { type SceneComponent, type SceneNode, validateSceneComponent } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { applyToFake } from '../support/apply';

/*
 * Real mapper output on the applier: the `@holotype/mapper` capture goldens (B-48) and its
 * synthetic-layer kitchen sink, copied into `mapper-scenes/` (the mapper's tests check the
 * copies are current). Each must apply to figma-fake without a failed component or an
 * error, and read back at its `expect` boxes.
 */

const DIR = new URL('./mapper-scenes/', import.meta.url);
const STORIES = readdirSync(DIR)
  .filter((name) => name.endsWith('.scene.json'))
  .sort()
  .map((name) => name.replace(/\.scene\.json$/, ''));

function load(story: string): SceneComponent {
  const raw: unknown = JSON.parse(readFileSync(new URL(`${story}.scene.json`, DIR), 'utf8'));
  const result = validateSceneComponent(raw);
  if (!result.ok) throw new Error(`${story} is not valid Scene IR: ${JSON.stringify(result.error)}`);
  return result.value;
}

const count = (node: SceneNode): number => 1 + (node.children ?? []).reduce((sum, child) => sum + count(child), 0);

/** Read-back tolerance between a written node and its `expect` box (07 §6.3). */
const TOL_READBACK = 1;

describe('mapper capture goldens → figma-fake', () => {
  it('covers the five slice stories and the synthetic-layer kitchen sink', () => {
    expect(STORIES).toEqual([
      'components-badge--default',
      'mapper-layers--kitchen-sink',
      'micro-borders--uniform',
      'micro-flex--row',
      'micro-text--mixed-inline',
      'micro-text--single-line',
    ]);
  });

  it.each(STORIES)('%s applies without errors and reads back at its expected boxes', async (story) => {
    const scene = load(story);
    const { figma, result } = await applyToFake({ scenes: [scene], assets: [] });
    expect(result.summary).toMatchObject({ componentsOk: 1, componentsFailed: 0, cancelled: false });
    const severe = result.report.diagnostics.filter((item) => item.severity === 'error' || item.severity === 'fatal');
    expect(severe).toEqual([]);
    const readback = result.report.components.flatMap((component) => component.variants.map((v) => v.readback));
    expect(readback.every((check) => check.maxDelta <= TOL_READBACK)).toBe(true);
    // Every Scene node became one Figma node under the variant frame.
    const written = figma.ops().filter((op) => op.method.startsWith('create')).length;
    expect(written).toBeGreaterThanOrEqual(scene.variants.reduce((sum, variant) => sum + count(variant.root), 0));
  });
});
