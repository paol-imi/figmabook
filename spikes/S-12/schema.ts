/** S-12 answers (14 S-12, BUILD B-29). Test-only. */
import { Type } from '@sinclair/typebox';
import { Nullable } from '../_shared/schema.ts';

export const S12Answers = {
  step1: Type.Object(
    {
      plan: Type.Union(
        ['starter', 'professional', 'organization', 'enterprise', 'unsure'].map((id) => Type.Literal(id)),
      ),
      bindableFields: Type.Object({
        bound: Type.Array(Type.String()),
        failed: Type.Array(Type.String()),
        total: Type.Integer(),
      }),
      modeLimit: Nullable(Type.Integer({ minimum: 1 })),
      modeLimitRefusal: Nullable(Type.String()),
      explicitModes: Type.Boolean(),
      codeSyntaxWeb: Type.Object({ set: Type.Integer(), readBackMatches: Type.Integer(), total: Type.Integer() }),
      aliasAcrossCollections: Type.Boolean(),
      documentationLinksOnSets: Type.Boolean(),
      textStyleBinding: Type.Boolean(),
      gradientStopBinding: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  step2: Type.Object(
    {
      libraryCollectionsListed: Type.Boolean(),
      libraryVariableHasCodeSyntax: Type.Boolean(),
      importVariableByKey: Type.Object({ ok: Type.Integer(), total: Type.Integer(), maxMs: Type.Number() }),
      codeSyntaxWebMatching: Type.Object({
        matched: Type.Integer(),
        total: Type.Integer(),
        unmatched: Type.Array(Type.String()),
      }),
      aliasAcrossCollectionsAfterImport: Type.Boolean(),
      explicitModeWithLibraryCollection: Type.Union([
        Type.Object({ remoteCollection: Type.Boolean(), changed: Type.Boolean() }),
        Type.Object({ error: Type.String() }),
      ]),
      bindImportedVariable: Type.Object({
        fill: Type.Union([Type.Boolean(), Type.String()]),
        padding: Type.Union([Type.Boolean(), Type.String()]),
      }),
    },
    { additionalProperties: false },
  ),
};
