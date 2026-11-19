/** S-05 answers: keep D-16 (model A) or flip to model B (14 S-05). Test-only. */
import { Type } from '@sinclair/typebox';
import { Nullable } from '../_shared/schema.ts';

const ModelStats = Type.Object({
  maxChildError: Nullable(Type.Number()),
  casesWithChildError: Type.Array(Type.String()),
  meanDiffRatio: Nullable(Type.Number()),
  failed: Type.Array(Type.String()),
});

export const S05Answers = {
  run: Type.Object(
    {
      modelA: ModelStats,
      modelB: ModelStats,
      measuredFavours: Type.Union([Type.Literal('A'), Type.Literal('B'), Type.Literal('tie')]),
      perSideWidthsInAutoLayout: Type.Object({ A: Nullable(Type.Number()), B: Nullable(Type.Number()) }),
      dashedCss: Nullable(Type.Object({ dash: Type.Number(), gap: Type.Number(), startsWithInk: Type.Boolean() })),
    },
    { additionalProperties: false },
  ),
  designer: Type.Object(
    {
      designerChoice: Type.Union([Type.Literal('A'), Type.Literal('B'), Type.Literal('both')]),
      reason: Type.String({ maxLength: 300 }),
    },
    { additionalProperties: false },
  ),
};
