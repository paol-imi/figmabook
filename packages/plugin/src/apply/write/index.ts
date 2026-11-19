/*
 * The node writer registry (BUILD §2.3: owned by B-14; one line per writer, append only).
 * Writers run in 09 §6 step order and, within a step, in the order listed here. Steps 0–2
 * (create, attach, defaults) and 10 (name, identity) are fixed and live in `node.ts`.
 */
import { positionWriter, sizeWriter } from './geometry';
import { textWriter } from './text';
import type { NodeWriter } from './types';
import { compositingWriter, cornerWriter, effectWriter, paintWriter } from './visuals';

export const WRITERS: readonly NodeWriter[] = [
  sizeWriter,
  positionWriter,
  textWriter,
  paintWriter,
  cornerWriter,
  effectWriter,
  compositingWriter,
];

/** {@link WRITERS} in run order: by step, stable within a step. */
export const orderedWriters = (writers: readonly NodeWriter[] = WRITERS): readonly NodeWriter[] =>
  writers
    .map((writer, index) => ({ writer, index }))
    .sort((a, b) => a.writer.step - b.writer.step || a.index - b.index)
    .map(({ writer }) => writer);
