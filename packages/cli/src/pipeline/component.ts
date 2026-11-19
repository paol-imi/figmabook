import type { CaptureSuccess } from '@holotype/capture';
import type { CaptureDoc, ComponentMetaInput, ComponentPlan, MapperSettings, SceneComponent } from '@holotype/ir';
import { mapComponent } from '@holotype/mapper';
import { compareSeverity, type Diagnostic, HolotypeError } from '@holotype/shared';
import type { IndexStory, StorybookSource } from '@holotype/storybook';
import type { RunComponent } from '../run-report';
import { redactSource, storybookLinks } from './source';

/** One component of a capture run: one story, in this version. */
export interface ComponentWork {
  readonly storyId: string;
  readonly sid: string;
  name: string;
  plan?: ComponentPlan;
  story?: IndexStory | undefined;
  readonly diagnostics: Diagnostic[];
  /** Successful captures by `vk`. */
  readonly captures: Map<string, CaptureSuccess>;
  scene?: SceneComponent;
  status: RunComponent['status'];
  readonly timings: { capture: number; map: number };
}

export interface MapContext {
  readonly source: StorybookSource;
  readonly baseUrl: string;
  readonly settings: MapperSettings;
  readonly elapsed: () => number;
}

/**
 * A capture as the bundle keeps it. A static build is served on an ephemeral loopback port
 * (03 §9.1); that port is not a fact of the design, and in `target.storybookUrl` it would
 * change the scene's `captureHash` on every run. It is replaced by the redacted source.
 */
export function portableCapture(doc: CaptureDoc, source: StorybookSource): CaptureDoc {
  if (source.kind !== 'static') return doc;
  let path = '/';
  try {
    path = new URL(doc.target.storybookUrl).pathname;
  } catch {
    // keep '/'
  }
  return { ...doc, target: { ...doc.target, storybookUrl: `${redactSource(source)}${path}` } };
}

/** What the storybook adapter knows of the component, for the mapper (06 §1.1). */
export function metaInput(
  plan: ComponentPlan,
  story: IndexStory,
  links: ComponentMetaInput['links'],
): ComponentMetaInput {
  return {
    sid: plan.sid,
    identity: plan.identity,
    titlePath: story.titlePath,
    description: '',
    descriptionSource: 'none',
    links,
    storyIds: [story.id],
    code: { sid: plan.sid, storiesPath: story.importPath, storyIds: [story.id] },
  };
}

/**
 * Maps a component whose variants were captured (07). Every planned variant must have been
 * captured, since a one-variant plan cannot be partial; a mapper failure (`PLAN_MAPPER_FAILED`,
 * `PLAN_INVARIANT_VIOLATION`) fails this component only. Sets `scene` and `status`.
 */
export function mapWork(work: ComponentWork, context: MapContext): void {
  const { plan, story } = work;
  if (plan === undefined || story === undefined) return;
  const planned = plan.variants.filter((variant) => work.captures.has(variant.vk));
  if (planned.length === 0) return;
  const captures = new Map<string, CaptureDoc>();
  for (const variant of planned) {
    const capture = work.captures.get(variant.vk);
    if (capture !== undefined) captures.set(variant.vk, portableCapture(capture.doc, context.source));
  }
  const t0 = context.elapsed();
  try {
    const output = mapComponent({
      sid: plan.sid,
      meta: metaInput(plan, story, storybookLinks(context.source, context.baseUrl, story.id)),
      plan: planned.length === plan.variants.length ? plan : { ...plan, variants: planned },
      captures,
      tokens: { tokens: null, byCssName: {} },
      components: new Map(),
      config: context.settings,
    });
    work.scene = output.scene;
    work.diagnostics.push(...output.diagnostics);
    const failed = work.diagnostics.some((item) => compareSeverity(item.severity, 'error') >= 0);
    work.status = planned.length < plan.variants.length || failed ? 'partial' : 'ok';
  } catch (error) {
    if (!(error instanceof HolotypeError)) throw error;
    work.diagnostics.push(...error.diagnostics.map((item) => ({ ...item, sid: work.sid })));
    work.status = 'failed';
  } finally {
    work.timings.map += context.elapsed() - t0;
  }
}

/** Why a component is missing from the bundle, for `report.json`. */
export function skipReason(work: ComponentWork): string {
  if (work.plan === undefined) return 'the story could not be planned';
  if (work.captures.size === 0) return 'no variant could be captured';
  return 'the mapper could not build the component';
}
