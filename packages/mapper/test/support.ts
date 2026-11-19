import { readFileSync } from 'node:fs';
import {
  type CaptureDoc,
  type ComponentMetaInput,
  type ComponentPlan,
  canonicalJSON,
  type MapperInput,
  type MapperSettings,
  type PlanAxis,
  type PlannedVariant,
  type SceneComponent,
  sceneNumKind,
  validateCaptureDoc,
} from '@holotype/ir';
import { DEFAULT_MAPPER_SETTINGS } from '../src';

/** Reads and validates a hand-built Capture IR fixture from `test/fixtures/<name>.capture.json`. */
export function loadCapture(name: string): CaptureDoc {
  const raw: unknown = JSON.parse(readFileSync(new URL(`./fixtures/${name}.capture.json`, import.meta.url), 'utf8'));
  const result = validateCaptureDoc(raw);
  if (!result.ok) throw new Error(`fixture ${name} is not a valid CaptureDoc: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Canonical Scene JSON (06 §5), pretty-printed for reading; keys stay sorted. */
export function sceneSnapshot(scene: SceneComponent): string {
  return `${JSON.stringify(JSON.parse(canonicalJSON(scene, { numKind: sceneNumKind })), null, 2)}\n`;
}

function meta(sid: string, displayName: string, storyIds: readonly string[]): ComponentMetaInput {
  return {
    sid,
    identity: { sid, displayName, importPath: `src/${displayName}.tsx`, exportName: displayName, framework: 'react' },
    titlePath: ['Components', displayName],
    description: `${displayName} fixture.`,
    descriptionSource: 'parameters',
    links: [{ label: 'Storybook', url: `http://127.0.0.1:6006/?path=/docs/${sid}--docs` }],
    storyIds,
    code: { sid, storiesPath: `src/${displayName}.stories.tsx`, storyIds: [...storyIds] },
  };
}

function plannedVariant(capture: CaptureDoc, values: Record<string, string>, isDefault: boolean): PlannedVariant {
  const { target } = capture;
  return {
    vk: target.vk,
    values,
    render: {
      storyId: target.storyId,
      args: target.args,
      globals: target.globals,
      viewport: { width: target.viewport.w, height: target.viewport.h },
    },
    isDefault,
  };
}

export interface SetVariant {
  readonly capture: CaptureDoc;
  /** Axis id → label. */
  readonly values: Record<string, string>;
}

export interface InputOptions {
  readonly displayName?: string;
  readonly axes?: readonly PlanAxis[];
  readonly layoutGrid?: ComponentPlan['layoutGrid'];
  readonly properties?: ComponentPlan['properties'];
  readonly config?: MapperSettings;
}

/** A `MapperInput` for one or more captures of the same component; the first variant is the default. */
export function mapperInput(variants: readonly SetVariant[], options: InputOptions = {}): MapperInput {
  const [first] = variants;
  if (first === undefined) throw new Error('mapperInput needs at least one variant');
  const { sid, storyId } = first.capture.target;
  const displayName = options.displayName ?? 'Fixture';
  const storyIds = [...new Set(variants.map((variant) => variant.capture.target.storyId))];
  const identity = meta(sid, displayName, storyIds).identity;
  const plan: ComponentPlan = {
    sid,
    identity,
    baseStoryId: storyId,
    axes: options.axes ?? [],
    properties: options.properties ?? [],
    fixedArgs: {},
    variants: variants.map((variant, i) => plannedVariant(variant.capture, variant.values, i === 0)),
    probes: [],
    modes: null,
    layoutGrid: options.layoutGrid ?? { columns: [], rows: [] },
    budget: { requested: variants.length, emitted: variants.length, strategy: 'auto', droppedAxes: [] },
    provenance: {},
    diagnostics: [],
  };
  return {
    sid,
    meta: meta(sid, displayName, storyIds),
    plan,
    captures: new Map(variants.map((variant) => [variant.capture.target.vk, variant.capture])),
    tokens: { tokens: null, byCssName: {} },
    components: new Map(),
    config: options.config ?? DEFAULT_MAPPER_SETTINGS,
  };
}

/** A single-variant `MapperInput` for one capture fixture. */
export function singleInput(capture: CaptureDoc, options: InputOptions = {}): MapperInput {
  return mapperInput([{ capture, values: {} }], options);
}

/** A copy of `capture` re-keyed as another variant: new story id, args and `vk`. */
export function asVariant(
  capture: CaptureDoc,
  storyId: string,
  vk: string,
  args: CaptureDoc['target']['args'],
): CaptureDoc {
  return { ...capture, target: { ...capture.target, storyId, vk, args } };
}

/** `DEFAULT_MAPPER_SETTINGS` with some fields replaced. */
export function settings(patch: (draft: MapperSettings) => MapperSettings): MapperSettings {
  return patch(structuredClone(DEFAULT_MAPPER_SETTINGS) as MapperSettings);
}
