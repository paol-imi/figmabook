/**
 * The S-07 failure-injection plan for the `faults` sandbox overlay
 * (`tools/sandboxes/overlays/faults`): healthy variants with a fault every `every` positions,
 * each followed by a recovery probe whose render is compared with a clean reference. Pure.
 */
import type { Json, Variant } from './plan.ts';

export type FaultKind =
  | 'throws'
  | 'throws-args'
  | 'never-settles'
  | 'slow-loader'
  | 'console-error'
  | 'play-fails'
  | 'unstable'
  | 'react-node-arg';

export const FAULT_KINDS: readonly FaultKind[] = [
  'throws',
  'throws-args',
  'never-settles',
  'slow-loader',
  'console-error',
  'play-fails',
  'unstable',
  'react-node-arg',
];

/** What a correct driver reports for a variant. */
export type Expectation =
  | { readonly ok: true; readonly warning?: string; readonly minMs?: number; readonly selector?: string }
  | { readonly ok: false; readonly code: string };

export interface FaultVariant extends Variant {
  readonly fault: FaultKind | null;
  readonly expect: Expectation;
  /** The fault this variant is the recovery probe of (its plan index). */
  readonly recoveryOf: number | null;
  /** Force the 03 §5.5 stability check. */
  readonly stability?: boolean;
}

interface Shape {
  readonly storyId: string;
  readonly args: Readonly<Record<string, Json>>;
  readonly expect: Expectation;
  readonly stability?: boolean;
}

/** The slow loader's delay: long enough to see, far below the render timeout. */
export const SLOW_LOADER_MS = 1500;

const FAULTS: Readonly<Record<FaultKind, Shape>> = {
  throws: { storyId: 'faults-probe--throws', args: {}, expect: { ok: false, code: 'SB_STORY_ERROR' } },
  'throws-args': {
    storyId: 'faults-probe--healthy',
    args: { crash: true, label: 'Crash' },
    expect: { ok: false, code: 'SB_STORY_ERROR' },
  },
  'never-settles': {
    storyId: 'faults-probe--never-settles',
    args: {},
    expect: { ok: false, code: 'SB_RENDER_TIMEOUT' },
  },
  'slow-loader': {
    storyId: 'faults-probe--slow-loader',
    args: { delayMs: SLOW_LOADER_MS },
    expect: { ok: true, minMs: SLOW_LOADER_MS },
  },
  'console-error': {
    storyId: 'faults-probe--console-error',
    args: {},
    expect: { ok: true, warning: 'SB_CONSOLE_ERROR' },
  },
  'play-fails': { storyId: 'faults-probe--play-fails', args: {}, expect: { ok: false, code: 'SB_PLAY_ERROR' } },
  unstable: {
    storyId: 'faults-unstable--ticking',
    args: {},
    expect: { ok: true, warning: 'CAP_UNSTABLE_RENDER' },
    stability: true,
  },
  'react-node-arg': {
    storyId: 'faults-slots--empty',
    args: { content: { $fromStory: 'faults-slots--filled', arg: 'content' } },
    expect: { ok: true, selector: '[data-filled]' },
  },
};

const TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const;
const SIZES = ['small', 'medium', 'large'] as const;

/** The healthy variant at position `n`: Example/Button and Faults/Probe states, all distinct. */
export function healthyShape(n: number): Shape {
  const ok: Expectation = { ok: true };
  switch (n % 4) {
    case 0:
      return {
        storyId: 'example-button--primary',
        args: { label: `Primary ${n}`, size: SIZES[n % 3] as string },
        expect: ok,
      };
    case 1:
      return {
        storyId: 'example-button--secondary',
        args: { label: `Secondary ${n}`, primary: n % 8 === 1 },
        expect: ok,
      };
    case 2:
      return {
        storyId: 'faults-probe--healthy',
        args: { label: `Probe ${n}`, tone: TONES[n % 5] as string },
        expect: ok,
      };
    default:
      return { storyId: 'faults-slots--filled', args: { title: `Frame ${n}` }, expect: ok };
  }
}

/** `count` healthy variants (no faults), as {@link healthyShape} gives them. */
export function healthyPlan(count: number): Variant[] {
  return Array.from({ length: count }, (_, index) => {
    const shape = healthyShape(index);
    return {
      index,
      storyId: shape.storyId,
      sid: shape.storyId.split('--')[0] ?? shape.storyId,
      args: shape.args,
      globals: {},
      label: labelOf(shape),
    };
  });
}

function labelOf(shape: Shape): string {
  const args = Object.entries(shape.args)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  return args === '' ? shape.storyId : `${shape.storyId} ${args}`;
}

/**
 * `count` variants; positions with `index % every === every / 2` (floored) are faults, in
 * {@link FAULT_KINDS} order, and the variant after each is its recovery probe. After
 * `throws-args` the probe re-renders the same story with `crash: false`.
 */
export function faultPlan(count = 200, every = 10): FaultVariant[] {
  if (!Number.isInteger(count) || count <= 0)
    throw new RangeError(`Variant count must be a positive integer, got ${count}.`);
  if (!Number.isInteger(every) || every < 2)
    throw new RangeError(`Fault spacing must be an integer ≥ 2, got ${every}.`);
  const offset = Math.floor(every / 2);
  const plan: FaultVariant[] = [];
  let faults = 0;
  for (let index = 0; index < count; index += 1) {
    const isFault = index % every === offset;
    const previous = plan[index - 1];
    let fault: FaultKind | null = null;
    let shape: Shape;
    if (isFault) {
      fault = FAULT_KINDS[faults % FAULT_KINDS.length] as FaultKind;
      faults += 1;
      shape = FAULTS[fault];
    } else if (previous?.fault === 'throws-args') {
      shape = {
        storyId: previous.storyId,
        args: { crash: false, label: `After crash ${index}` },
        expect: { ok: true },
      };
    } else {
      shape = healthyShape(index);
    }
    plan.push({
      index,
      storyId: shape.storyId,
      sid: shape.storyId.split('--')[0] ?? shape.storyId,
      args: shape.args,
      globals: {},
      label: labelOf(shape),
      fault,
      expect: shape.expect,
      recoveryOf: previous?.fault != null ? previous.index : null,
      ...(shape.stability === undefined ? {} : { stability: shape.stability }),
    });
  }
  return plan;
}

/** What a driver reported for one variant, reduced to what the expectation checks. */
export interface Observed {
  readonly ok: boolean;
  readonly code?: string;
  readonly warnings: readonly string[];
  readonly ms: number;
  /** Whether the expectation's selector matched in the rendered root. */
  readonly selectorFound?: boolean;
}

/** `true` when the driver reported what the variant expects. */
export function meetsExpectation(expect: Expectation, observed: Observed): boolean {
  if (!expect.ok) return !observed.ok && observed.code === expect.code;
  if (!observed.ok) return false;
  if (expect.warning !== undefined && !observed.warnings.includes(expect.warning)) return false;
  if (expect.minMs !== undefined && observed.ms < expect.minMs) return false;
  if (expect.selector !== undefined && observed.selectorFound !== true) return false;
  return true;
}
