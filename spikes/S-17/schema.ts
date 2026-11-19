/** S-17 answers: plugin data on branch creation, update from main and merge (14 S-17). Test-only. */
import { Type } from '@sinclair/typebox';
import { Nullable, Survival } from '../_shared/schema.ts';

const Chunk = Type.Object({ root: Type.String(), component: Type.String() });

const Answers = Type.Object(
  {
    branchCreationWithoutUi: Type.String(),
    onCreate: Type.Object({ root: Survival, component: Survival, chunk90kB: Chunk }),
    branchWritesVisibleInMainBeforeMerge: Nullable(Type.Boolean()),
    onUpdateFromMain: Type.Object({
      mainWritesArrived: Survival,
      branchWritesKept: Survival,
      editValue: Nullable(Type.String()),
    }),
    onMerge: Type.Object({
      branchWritesArrived: Survival,
      editValue: Nullable(Type.String()),
      mainWritesKept: Survival,
      step1MarkersKept: Survival,
      chunk90kB: Chunk,
    }),
    fileKey: Type.Object({ branchHasOwnKey: Nullable(Type.Boolean()), mainKeyStable: Nullable(Type.Boolean()) }),
    stepsRun: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const S17Answers = { step1: Answers, step2: Answers, step3: Answers, step4: Answers, step5: Answers };
