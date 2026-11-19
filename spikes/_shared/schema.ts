/**
 * JSON Schema (TypeBox) of the result envelope. Per-spike `schema.ts` files describe the
 * `results.answers` block, so tests prove each result answers its spike's questions.
 * Test-only: the plugin bundles never import these schemas (S-06 bundles only TypeBox's compiler).
 */
import { type TSchema, Type } from '@sinclair/typebox';
import { ENVELOPE_FORMAT } from './envelope.ts';

export const Env = Type.Object(
  {
    apiVersion: Type.String(),
    editorType: Type.String(),
    client: Type.Union([Type.Literal('desktop'), Type.Literal('browser'), Type.Literal('unknown')]),
    os: Type.Union([
      Type.Literal('macos'),
      Type.Literal('windows'),
      Type.Literal('linux'),
      Type.Literal('chromeos'),
      Type.Literal('other'),
    ]),
  },
  { additionalProperties: false },
);

/** The envelope with `results.answers` of the given shape. */
export function envelopeSchema(spike: string, step: string, answers: TSchema) {
  return Type.Object(
    {
      format: Type.Literal(ENVELOPE_FORMAT),
      spike: Type.Literal(spike),
      kitVersion: Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$' }),
      step: Type.Literal(step),
      status: Type.Literal('done'),
      env: Env,
      results: Type.Object({ answers }),
    },
    { additionalProperties: false },
  );
}

export const FailedEnvelope = Type.Object(
  {
    format: Type.Literal(ENVELOPE_FORMAT),
    spike: Type.String(),
    kitVersion: Type.String(),
    step: Type.String(),
    status: Type.Literal('failed'),
    env: Env,
    results: Type.Object({ error: Type.String() }, { additionalProperties: false }),
  },
  { additionalProperties: false },
);

export const Survival = Type.Union([
  Type.Literal('yes'),
  Type.Literal('no'),
  Type.Literal('partial'),
  Type.Literal('not-run'),
]);
export const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
