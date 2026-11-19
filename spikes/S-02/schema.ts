/** S-02 answers: placement per override kind, then the survival matrix summary (10 §11.1). Test-only. */
import { Type } from '@sinclair/typebox';

const Placement = Type.Array(
  Type.Object({
    override: Type.String(),
    applied: Type.Integer(),
    total: Type.Integer(),
    errors: Type.Array(Type.String()),
  }),
  { minItems: 13, maxItems: 13 },
);

const Summary = Type.Object({
  kept: Type.Integer(),
  lost: Type.Integer(),
  partial: Type.Integer(),
  other: Type.Integer(),
  safeMutations: Type.Array(Type.String({ pattern: '^M\\d\\d$' })),
  unsafeMutations: Type.Array(Type.String({ pattern: '^M\\d\\d$' })),
});

export const S02Answers = {
  step1: Type.Object({ sameFilePlacement: Placement }, { additionalProperties: false }),
  step2: Type.Object({ consumerPlacement: Placement }, { additionalProperties: false }),
  step3: Type.Object({ scope: Type.Literal('same-file'), summary: Summary }, { additionalProperties: false }),
  step4: Type.Object(
    { scope: Type.Literal('library'), libraryUpdateSeen: Type.Boolean(), summary: Summary },
    { additionalProperties: false },
  ),
};

/** The full matrix shipped next to the answers in steps 3 and 4. */
export const S02Matrix = Type.Object({
  legend: Type.String(),
  columns: Type.Array(Type.String(), { minItems: 13, maxItems: 13 }),
  rows: Type.Array(
    Type.Object({
      mutation: Type.String({ pattern: '^M\\d\\d$' }),
      label: Type.String(),
      mutationApplied: Type.Union([Type.Boolean(), Type.Null()]),
      mutationNotes: Type.Array(Type.String()),
      codes: Type.String({ pattern: '^[KLPANME]{13}$' }),
      grades: Type.Record(Type.String(), Type.String()),
    }),
    { minItems: 19, maxItems: 19 },
  ),
  details: Type.Array(Type.Object({ cell: Type.String(), grade: Type.String() })),
  summary: Summary,
});
