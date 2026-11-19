import type { BaselineSnapshot, FigmaSnapshot, SnapNode } from '@holotype/dcr';
import type { CaseInput } from './case.ts';
import type { FixtureProvenance } from './schemas.ts';

/*
 * Seeded input shuffles for the determinism test (12 §2.4, D-35). A shuffle permutes the key
 * order of every object and the order of every order-free array (see `order-free.ts`), and
 * nothing else. The same seed always gives the same permutation, so a failure reproduces.
 */

/** The seeds of the two shuffled runs (the first run uses the input as is). */
export const SHUFFLE_SEEDS = [0x5eed_0001, 0x5eed_0002] as const;

/** mulberry32: a small, fast, seeded PRNG. Returns floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A Fisher–Yates permutation of a copy of `items`. */
export function permute<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** A deep copy with every object's keys in a random order. Arrays keep their order. */
export function shuffleKeys<T>(value: T, random: () => number): T {
  if (Array.isArray(value)) return value.map((item) => shuffleKeys(item, random)) as T;
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of permute(Object.keys(value), random)) {
    const item = (value as Record<string, unknown>)[key];
    // A data property even for a key like `__proto__`.
    Object.defineProperty(out, key, {
      value: shuffleKeys(item, random),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out as T;
}

function shuffleNode(node: SnapNode, random: () => number): SnapNode {
  const out: SnapNode = { ...node };
  if (node.annotations) out.annotations = permute(node.annotations, random);
  if (node.instance) {
    out.instance = {
      ...node.instance,
      overrides: permute(
        node.instance.overrides.map((o) => ({ ...o, fields: permute(o.fields, random) })),
        random,
      ),
    };
  }
  return out;
}

function shuffleSnapshot(snapshot: FigmaSnapshot, random: () => number): FigmaSnapshot {
  return {
    ...snapshot,
    pages: permute(
      snapshot.pages.map((page) => ({ ...page, topLevel: permute(page.topLevel, random) })),
      random,
    ),
    nodes: Object.fromEntries(Object.entries(snapshot.nodes).map(([id, node]) => [id, shuffleNode(node, random)])),
  };
}

function shuffleProvenance(provenance: FixtureProvenance, random: () => number): FixtureProvenance {
  return { ...provenance, components: permute(provenance.components, random) };
}

/**
 * The case input with order-free arrays and all key orders permuted by `seed`. Pure.
 * `config` is left as is: `screens.states` key order is the render order (16 §15), and
 * the extractor reads the config from `branch:meta`, a canonical JSON string.
 */
export function shuffleInput(input: CaseInput, seed: number): CaseInput {
  const random = seededRandom(seed);
  const branch = shuffleKeys(shuffleSnapshot(input.branch, random), random);
  const baseline: BaselineSnapshot[] = shuffleKeys(permute(input.baseline, random), random);
  const out: CaseInput = { branch, baseline, config: input.config };
  if (input.provenance) out.provenance = shuffleKeys(shuffleProvenance(input.provenance, random), random);
  return out;
}
