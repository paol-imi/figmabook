import type { CaptureDoc, SceneComponent, TokenSet } from '@holotype/ir';
import { NotImplementedError } from '@holotype/shared';

/** Mapper settings. Defaults follow README §5. */
export interface MapperOptions {
  /** Max simulated-vs-captured box error for emitting auto layout (D-15 `TOL_SIM`), px. */
  readonly tolSim: number;
  /** Default text wrap mode (D-17). */
  readonly textWrapMode: 'reflow' | 'locked-lines';
  /** Bind tokens by value equality too, flagged low-confidence (D-18: opt-in). */
  readonly tokenValueMatching: boolean;
}

export const DEFAULT_MAPPER_OPTIONS: MapperOptions = Object.freeze({
  tolSim: 0.6,
  textWrapMode: 'reflow',
  tokenValueMatching: false,
});

/** Fills in defaults and rejects values that cannot be meant. */
export function resolveMapperOptions(options: Partial<MapperOptions> = {}): MapperOptions {
  const resolved = { ...DEFAULT_MAPPER_OPTIONS, ...options };
  if (!Number.isFinite(resolved.tolSim) || resolved.tolSim < 0) {
    throw new RangeError(`tolSim must be a finite number ≥ 0, got ${resolved.tolSim}.`);
  }
  return resolved;
}

/** Everything the mapper needs for one component: its captures and the planner's decisions. */
export interface MapInput {
  readonly sid: string;
  readonly captures: readonly CaptureDoc[];
  readonly options?: Partial<MapperOptions>;
}

/** Pure Capture IR → Scene IR for one component (D-08). */
export function mapComponent(input: MapInput): SceneComponent {
  resolveMapperOptions(input.options);
  throw new NotImplementedError('mapComponent', 'Phase 1');
}

/** Resolves CSS custom properties into variables, aliases and modes (08). */
export function mapTokens(_captures: readonly CaptureDoc[]): TokenSet {
  throw new NotImplementedError('mapTokens', 'Phase 5');
}
