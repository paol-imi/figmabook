import { type Static, Type } from '@sinclair/typebox';
import { Enum, Hash16Schema, JsonValueSchema, RatioSchema, SemverSchema } from './primitives';
import { SceneEffectSchema, SceneTextRangeSchema } from './scene';

/** A variable value in one mode (06 §4.3). */
export const TokenValueSchema = Type.Union([
  Type.Object({ kind: Type.Literal('color'), r: RatioSchema, g: RatioSchema, b: RatioSchema, a: RatioSchema }),
  Type.Object({ kind: Type.Literal('float'), value: Type.Number() }),
  Type.Object({ kind: Type.Literal('string'), value: Type.String() }),
  Type.Object({ kind: Type.Literal('boolean'), value: Type.Boolean() }),
  /** Another variable, by key. */
  Type.Object({ kind: Type.Literal('alias'), variable: Type.String({ minLength: 1 }) }),
]);
export type TokenValue = Static<typeof TokenValueSchema>;

/** `TIMING`/`EASING` only with feature `tokens-motion`. */
export const TokenTypeSchema = Enum('COLOR', 'FLOAT', 'STRING', 'BOOLEAN', 'TIMING', 'EASING');
export type TokenType = Static<typeof TokenTypeSchema>;

export const TokenCollectionSchema = Type.Object({
  /** e.g. `col:primitives`. */
  key: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  modes: Type.Array(
    Type.Object({
      key: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
      source: Type.Object({
        global: Type.Optional(Type.String()),
        value: Type.Optional(JsonValueSchema),
        selector: Type.Optional(Type.String()),
      }),
    }),
    { minItems: 1 },
  ),
  /** A mode key. */
  defaultMode: Type.String({ minLength: 1 }),
  hiddenFromPublishing: Type.Optional(Type.Boolean()),
});
export type TokenCollection = Static<typeof TokenCollectionSchema>;

export const TokenVariableSchema = Type.Object({
  /** Stable, from the CSS name: `var:color/primary-500`. */
  key: Type.String({ minLength: 1 }),
  /** A collection key. */
  collection: Type.String({ minLength: 1 }),
  /** Figma name `color/primary-500` (08 §naming). */
  name: Type.String({ minLength: 1 }),
  type: TokenTypeSchema,
  /** Mode key → value. */
  valuesByMode: Type.Record(Type.String(), TokenValueSchema),
  /** e.g. `["FRAME_FILL", "SHAPE_FILL"]` (08 §scopes). */
  scopes: Type.Array(Type.String()),
  /** `var(--color-primary-500)`: the primary library match key (D-18). */
  codeSyntax: Type.Object({ WEB: Type.String() }),
  description: Type.Optional(Type.String()),
  /** `usedBy` is excluded from the tokens `irh`. */
  provenance: Type.Object({
    cssName: Type.String({ pattern: '^--' }),
    declaredAt: Type.Array(Type.String()),
    usedBy: Type.Integer({ minimum: 0 }),
  }),
  /** Filled by the plugin preflight. */
  match: Type.Optional(
    Type.Object({
      kind: Enum('library', 'local'),
      key: Type.Optional(Type.String()),
      id: Type.Optional(Type.String()),
      by: Enum('codeSyntax', 'name'),
    }),
  ),
});
export type TokenVariable = Static<typeof TokenVariableSchema>;

/** `tokens.json` (06 §4.3), produced by the token resolver (08). */
export const TokensDocSchema = Type.Object(
  {
    kind: Type.Literal('holotype/tokens'),
    tokensVersion: SemverSchema,
    irh: Hash16Schema,
    collections: Type.Array(TokenCollectionSchema),
    variables: Type.Array(TokenVariableSchema),
    textStyles: Type.Optional(
      Type.Array(
        Type.Object({
          key: Type.String({ minLength: 1 }),
          name: Type.String({ minLength: 1 }),
          range: Type.Omit(SceneTextRangeSchema, ['start', 'end', 'fills', 'hyperlink']),
        }),
      ),
    ),
    effectStyles: Type.Optional(
      Type.Array(
        Type.Object({
          key: Type.String({ minLength: 1 }),
          name: Type.String({ minLength: 1 }),
          effects: Type.Array(SceneEffectSchema),
        }),
      ),
    ),
  },
  { title: 'Holotype tokens (TokensDoc)' },
);
export type TokensDoc = Static<typeof TokensDocSchema>;
