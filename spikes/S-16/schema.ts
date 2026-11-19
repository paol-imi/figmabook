/** S-16 answers: the reversibility table and valueMap gaps (14 S-16). Test-only. */
import { Type } from '@sinclair/typebox';

const Kind = Type.Object({ cases: Type.Integer(), roundTrip: Type.Integer(), failed: Type.Array(Type.String()) });

export const S16Answers = {
  run: Type.Object(
    {
      reversibility: Type.Object(
        { VARIANT: Kind, BOOLEAN: Kind, TEXT: Kind, INSTANCE_SWAP: Kind, nested: Kind, SLOT: Type.String() },
        { additionalProperties: false },
      ),
      valueMapGaps: Type.Array(Type.String()),
      overridesOutsideProperties: Type.Array(Type.String()),
      surprises: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
};
