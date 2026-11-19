import { CodeRefSchema, Enum, JsonValueSchema, RefTo } from '@holotype/ir';
import { type Static, type TSchema, Type } from '@sinclair/typebox';
import { CssVarSchema, DcrHashSchema, SidSchema, UntrustedTextSchema } from './primitives';
import { FieldChangeSchema } from './snapshot';

/*
 * Usage trees (15 §4.5–§4.6, §4.12, §7.3): how screens and new components are composed
 * from instances, frames and text. Screen nodes have no `nk`, so each node carries a
 * deterministic path key (`name:index` chain).
 */

/** A value with its token (`codeSyntax.WEB` name), or a raw value with token candidates (15 §4.7). */
export const TokenOrValueSchema = Type.Union([
  Type.Object({ token: CssVarSchema, value: JsonValueSchema }),
  Type.Object({
    value: JsonValueSchema,
    untokenized: Type.Literal(true),
    /** Tokens whose value equals this one exactly, sorted by name. */
    candidates: Type.Optional(Type.Array(CssVarSchema)),
  }),
]);
export type TokenOrValue = Static<typeof TokenOrValueSchema>;

const SizingSchema = Enum('hug', 'fill', 'fixed');

export const LayoutHintSchema = Type.Object({
  direction: Enum('row', 'column', 'grid', 'none'),
  gap: Type.Optional(TokenOrValueSchema),
  /** Top, right, bottom, left. */
  padding: Type.Optional(Type.Tuple([TokenOrValueSchema, TokenOrValueSchema, TokenOrValueSchema, TokenOrValueSchema])),
  align: Type.Optional(Type.String()),
  justify: Type.Optional(Type.String()),
  wrap: Type.Optional(Type.Boolean()),
  sizing: Type.Optional(Type.Object({ w: SizingSchema, h: SizingSchema })),
  fixed: Type.Optional(Type.Object({ w: Type.Optional(Type.Number()), h: Type.Optional(Type.Number()) })),
});
export type LayoutHint = Static<typeof LayoutHintSchema>;

/** A text style: its token (a text-style CSS name), or the raw font values. */
export const TextHintSchema = Type.Object({
  token: Type.Optional(CssVarSchema),
  family: Type.Optional(Type.String()),
  style: Type.Optional(Type.String()),
  size: Type.Optional(Type.Number({ minimum: 0 })),
  lineHeight: Type.Optional(JsonValueSchema),
  untokenized: Type.Optional(Type.Literal(true)),
  candidates: Type.Optional(Type.Array(CssVarSchema)),
});
export type TextHint = Static<typeof TextHintSchema>;

/** Copy vs placeholder (15 §4.12). */
export const ContentKindSchema = Type.Union([
  Type.Object({ kind: Type.Literal('copy') }),
  Type.Object({
    kind: Type.Literal('placeholder'),
    reason: Enum('lorem', 'template', 'component-default', 'pattern'),
    /** For `template`: the trimmed inner text of `{{…}}`, e.g. `order.total`. */
    variable: Type.Optional(Type.String()),
  }),
]);
export type ContentKind = Static<typeof ContentKindSchema>;

/** A path key: `Checkout:0/Summary:2/Total:0`. */
const UsageKeySchema = Type.String({ minLength: 1 });

function usageInstance<N extends TSchema>(node: N) {
  return Type.Object({
    sid: SidSchema,
    component: CodeRefSchema,
    /** Arg name → value; a value with no `valueMap` entry is `{ unmapped: <Figma value> }` (DCR_PROPERTY_UNMAPPED). */
    props: Type.Record(Type.String(), JsonValueSchema),
    /** SLOT arg → nested usage. */
    slots: Type.Optional(Type.Record(Type.String(), Type.Array(node))),
    /** Overrides not explained by component properties (15 §4.5 step 3). */
    deviations: Type.Optional(Type.Array(FieldChangeSchema)),
    /** TEXT arg → copy or placeholder. */
    content: Type.Optional(Type.Record(Type.String(), ContentKindSchema)),
    /** Arg names equal to the component default; omitted from the snippet. Sorted. */
    defaults: Type.Optional(Type.Array(Type.String())),
  });
}

/** One node of a usage tree (15 §4.6). Recursive through frame children and instance slots. */
export const UsageNodeSchema = Type.Recursive(
  (This) =>
    Type.Union([
      Type.Object({ t: Type.Literal('instance'), key: UsageKeySchema, inst: usageInstance(This) }),
      Type.Object({
        t: Type.Literal('frame'),
        key: UsageKeySchema,
        name: UntrustedTextSchema,
        layout: Type.Optional(LayoutHintSchema),
        fills: Type.Optional(Type.Array(TokenOrValueSchema)),
        radius: Type.Optional(TokenOrValueSchema),
        children: Type.Array(This),
      }),
      Type.Object({
        t: Type.Literal('text'),
        key: UsageKeySchema,
        characters: UntrustedTextSchema,
        style: TextHintSchema,
        /** Absent in the Loop slice, which does not classify text (15 §4.12). */
        content: Type.Optional(ContentKindSchema),
      }),
      /** `asset` is a role id (`<itemId>:…`) resolved through `assets.json`. */
      Type.Object({ t: Type.Literal('image'), key: UsageKeySchema, asset: Type.String({ minLength: 1 }) }),
      /** An instance of a component that a `component.new` item of this request proposes. */
      Type.Object({ t: Type.Literal('new-component-ref'), key: UsageKeySchema, itemId: DcrHashSchema }),
    ]),
  { $id: 'UsageNode' },
);
export type UsageNode = Static<typeof UsageNodeSchema>;

/** A `$ref` to `UsageNode`; documents that use it embed `UsageNodeSchema` under `$defs`. */
export const UsageNodeRef = RefTo(UsageNodeSchema);

/** An instance in a usage tree, as one reverse-mapped component use (15 §4.5). */
export const UsageInstanceSchema = usageInstance(UsageNodeRef);
export type UsageInstance = Static<typeof UsageInstanceSchema>;

/** A difference of a screen variant (or a component variant) against its base tree (15 §4.10). */
export const UsageDeltaSchema = Type.Union([
  Type.Object({ key: UsageKeySchema, op: Type.Literal('added'), node: UsageNodeRef }),
  Type.Object({ key: UsageKeySchema, op: Type.Literal('removed') }),
  Type.Object({
    key: UsageKeySchema,
    op: Type.Literal('props'),
    before: Type.Record(Type.String(), JsonValueSchema),
    after: Type.Record(Type.String(), JsonValueSchema),
  }),
  Type.Object({ key: UsageKeySchema, op: Type.Literal('layout'), before: LayoutHintSchema, after: LayoutHintSchema }),
  Type.Object({
    key: UsageKeySchema,
    op: Type.Literal('text'),
    before: UntrustedTextSchema,
    after: UntrustedTextSchema,
  }),
]);
export type UsageDelta = Static<typeof UsageDeltaSchema>;

/** A JSX-like spec sketch of a usage tree (15 §7.3); never code to paste. */
export const UsageSnippetSchema = Type.Object({
  lang: Type.Literal('jsx-sketch'),
  /** One line per module specifier, sorted. */
  imports: Type.Array(Type.String()),
  code: Type.String(),
});
export type UsageSnippet = Static<typeof UsageSnippetSchema>;
