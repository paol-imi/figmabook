import type { SceneNode as IrNode, Rect } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import type { FigmaPort } from '../../port';
import type { Resources } from '../resources';

/** What every writer of one variant shares. */
export interface WriteContext {
  readonly port: FigmaPort;
  readonly sid: string;
  readonly variantKey: string;
  readonly resources: Resources;
  readonly emit: (diagnostic: Diagnostic) => void;
}

/** One node being written: the Figma node, its Scene IR node and its box in the parent. */
export interface WriteTarget {
  readonly node: SceneNode;
  readonly scene: IrNode;
  /** Position and size relative to the parent (absolute layout, D-15). */
  readonly box: Rect;
}

/**
 * One step of the per-node write sequence (09 §6). Writers run in `step` order, and in
 * registry order within a step (`write/index.ts`). A writer only writes what its step owns.
 */
export interface NodeWriter {
  readonly name: string;
  /** The 09 §6 step number: 4 size, 5 position, 7 content, 8 visuals. */
  readonly step: number;
  write(target: WriteTarget, context: WriteContext): void;
}

/** Figma throws below this size (09 §6.2). */
export const MIN_SIZE = 0.01;

export const atLeastMin = (value: number): number => Math.max(value, MIN_SIZE);
