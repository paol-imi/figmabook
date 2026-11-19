import { type Static, Type } from '@sinclair/typebox';
import { Hash16Schema, SemverSchema } from './common';

/** `tokens.json`: variable collections, modes and variables (06 §4.3). v0 pins the envelope. */
export const TokenSetSchema = Type.Object(
  {
    kind: Type.Literal('holotype/tokens'),
    tokensVersion: SemverSchema,
    irh: Hash16Schema,
    collections: Type.Array(Type.Object({ key: Type.String(), name: Type.String(), defaultMode: Type.String() })),
    variables: Type.Array(
      Type.Object({
        key: Type.String(),
        collection: Type.String(),
        name: Type.String(),
        type: Type.Union([
          Type.Literal('COLOR'),
          Type.Literal('FLOAT'),
          Type.Literal('STRING'),
          Type.Literal('BOOLEAN'),
        ]),
      }),
    ),
  },
  { title: 'Holotype tokens (TokensDoc)' },
);

/** The contents of `tokens.json` (called `TokensDoc` in 06 §4.3). */
export type TokenSet = Static<typeof TokenSetSchema>;
