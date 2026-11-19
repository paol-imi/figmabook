import { type ComponentIdentity, type ComponentPlan, type PlannedVariant, variantKey } from '@holotype/ir';
import { createDiagnostic, type Diagnostic, diagnostic, err, ok, type Result } from '@holotype/shared';
import type { IndexStory, SbCapabilities, StorybookModel } from '@holotype/storybook';

/** The capture viewport of D-24 (1280×800), used when the caller gives none. */
export const DEFAULT_VIEWPORT: Readonly<{ width: number; height: number }> = Object.freeze({
  width: 1280,
  height: 800,
});

export interface SingleStoryOptions {
  /** Page viewport of the one render. Default {@link DEFAULT_VIEWPORT}. */
  readonly viewport?: { readonly width: number; readonly height: number };
}

/**
 * The framework a component is written in, from the Storybook renderer package
 * (`@storybook/react` → `react`), else the framework package (`@storybook/react-vite` →
 * `react`), else `unknown`.
 */
export function frameworkOf(caps: Pick<SbCapabilities, 'renderer' | 'framework'>): string {
  const name = caps.renderer ?? caps.framework;
  if (name === undefined) return 'unknown';
  return name.replace(/^@storybook\//, '').replace(/-(?:vite|webpack5|webpack)$/, '') || 'unknown';
}

/** The adapter's identity of the component a story belongs to (03 §7.2), from the index alone. */
export function identityOf(story: IndexStory, caps: Pick<SbCapabilities, 'renderer' | 'framework'>): ComponentIdentity {
  return {
    sid: story.sid,
    displayName: story.titlePath.at(-1) ?? story.sid,
    importPath: story.importPath,
    ...(story.componentPath === undefined ? {} : { componentPath: story.componentPath }),
    framework: frameworkOf(caps),
  };
}

function storyMissing(model: StorybookModel, storyId: string): Diagnostic {
  const excluded = model.excluded.find((story) => story.id === storyId);
  return createDiagnostic(diagnostic('SB_STORY_MISSING'), undefined, {
    value: storyId,
    data:
      excluded === undefined
        ? { reason: 'the story id is not in the Storybook index' }
        : { reason: 'the story is in the index but the story filter excludes it', exclusion: excluded.reason },
  });
}

/**
 * Plans one story as a one-variant component (BUILD B-13): the story's own args and globals,
 * one viewport, no axes and no properties. The full planner (`planComponent`, 04) replaces
 * this once stories-as-variants and args land (B-50).
 *
 * Returns `SB_STORY_MISSING` when `storyId` is not one of the model's (filtered) stories.
 */
export function planSingleStory(
  model: StorybookModel,
  storyId: string,
  options: SingleStoryOptions = {},
): Result<ComponentPlan, Diagnostic> {
  const story = model.stories.find((entry) => entry.id === storyId);
  if (story === undefined) return err(storyMissing(model, storyId));
  const { width, height } = options.viewport ?? DEFAULT_VIEWPORT;
  const render = { storyId, args: {}, globals: {}, viewport: { width, height } };
  const variant: PlannedVariant = {
    vk: variantKey({ storyId, args: {}, globals: {}, state: null, viewport: { w: width, h: height } }),
    values: {},
    render,
    isDefault: true,
  };
  return ok({
    sid: story.sid,
    identity: identityOf(story, model.caps),
    baseStoryId: storyId,
    axes: [],
    properties: [],
    fixedArgs: {},
    variants: [variant],
    probes: [],
    modes: null,
    layoutGrid: { columns: [], rows: [] },
    budget: { requested: 1, emitted: 1, strategy: 'auto', droppedAxes: [] },
    provenance: {},
    diagnostics: [],
  });
}
