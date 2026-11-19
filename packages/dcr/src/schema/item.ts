import {
  CodeRefSchema,
  DiagnosticSchema,
  Enum,
  FieldOriginSchema,
  JsonValueSchema,
  PropertyTypeSchema,
  RelativePathSchema,
  SourceLocSchema,
} from '@holotype/ir';
import { type Static, type TLiteral, type TProperties, type TSchema, Type } from '@sinclair/typebox';
import {
  CssVarSchema,
  DcrHashSchema,
  FigmaNodeIdSchema,
  SidSchema,
  UntrustedTextSchema,
  VariantValuesSchema,
  VkSchema,
} from './primitives';
import { ScreenVariantSchema } from './screen';
import { FieldChangeSchema } from './snapshot';
import { UsageDeltaSchema, UsageNodeRef, UsageSnippetSchema } from './usage';

/*
 * DCR items (15 §4.4, §6). Each kind is its own member of a union over `kind`, so the
 * fields a kind needs are required for that kind. Fields marked "CLI-added" are attached
 * by the CLI from capture provenance after extraction; they are outside the core hash
 * (15 §4.9, D-50; see `dcrCore`).
 */

/** Every item kind, in canonical item order (15 §4.9 `kindOrder`). */
export const DCR_ITEM_KINDS = [
  'component.modified',
  'variant.added',
  'variant.removed',
  'property.added',
  'property.changed',
  'node.added',
  'node.removed',
  'component.new',
  'screen',
  'instance.detached',
  'instance.deviation',
  'instance.outdated',
  'instance.deprecated',
  'token.changed',
  'token.added',
  'unknown',
] as const;
export const DcrItemKindSchema = Enum(...DCR_ITEM_KINDS);
export type DcrItemKind = Static<typeof DcrItemKindSchema>;

/** The kinds the Loop slice extracts (BUILD §4.2); the others are hardening. */
export const SLICE_ITEM_KINDS = [
  'component.modified',
  'variant.added',
  'property.added',
  'property.changed',
  'node.added',
  'node.removed',
  'component.new',
  'screen',
  'unknown',
] as const satisfies readonly DcrItemKind[];

// ---------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------

/** A designer note (15 §6). Authors are never stored (13, 15 §10.2). */
export const DcrNoteSchema = Type.Object({
  source: Enum('annotation', 'comment', 'description'),
  text: UntrustedTextSchema,
  author: Type.Optional(Type.Never({ description: 'Never stored (15 §10.2)' })),
});
export type DcrNote = Static<typeof DcrNoteSchema>;

/** A field change with what the item adds to it (15 §5.4, §6). */
export const DcrChangeSchema = Type.Object({
  ...FieldChangeSchema.properties,
  /** CLI-added. */
  origin: Type.Optional(FieldOriginSchema),
  /** CLI-added: the CSS value to write, after reverse arithmetic (15 §5.2). Never write `before`/`after`. */
  css: Type.Optional(Type.Object({ property: Type.String(), before: Type.String(), after: Type.String() })),
  token: Type.Optional(
    Type.Object({
      before: Type.Optional(CssVarSchema),
      after: Type.Optional(CssVarSchema),
      /** Sorted by name. */
      candidates: Type.Optional(Type.Array(CssVarSchema)),
    }),
  ),
  /** CLI-added: the blast radius (15 §5.4). */
  reach: Type.Optional(
    Type.Object({ sameOriginVariants: Type.Array(VkSchema), designerChangedIn: Type.Array(VkSchema) }),
  ),
  /** CLI-added, `var()` origins only: the line that defines the variable. */
  varDefinition: Type.Optional(SourceLocSchema),
});
export type DcrChange = Static<typeof DcrChangeSchema>;

export const StoryRequirementSchema = Enum('existing', 'must-add', 'optional');
export type StoryRequirement = Static<typeof StoryRequirementSchema>;

function acceptance<S extends TSchema>(story: S) {
  return Type.Object({
    type: Enum('fields', 'visual', 'structure', 'usage'),
    /** `component.modified`: Scene value within `tol` of `expect`. Sorted by field. */
    fields: Type.Optional(
      Type.Array(
        Type.Object({
          field: Type.String({ minLength: 1 }),
          expect: JsonValueSchema,
          tol: Type.Optional(Type.Number({ minimum: 0 })),
        }),
      ),
    ),
    /** The binding must be exactly this variable. Sorted by field. */
    token: Type.Optional(Type.Array(Type.Object({ field: Type.String({ minLength: 1 }), expect: CssVarSchema }))),
    /** Advisory (D-55). */
    visual: Type.Optional(
      Type.Object({ sMaskedMin: Type.Number({ minimum: 0, maximum: 1 }), boxDeltaMax: Type.Number({ minimum: 0 }) }),
    ),
    /** `screen` / `instance.*`: sids that must (not) be imported. Sorted. */
    usage: Type.Optional(
      Type.Object({ mustImport: Type.Array(SidSchema), mustNotImport: Type.Optional(Type.Array(SidSchema)) }),
    ),
    story,
  });
}

/** What verify checks (15 §6, §9.2). */
export const AcceptanceSchema = acceptance(StoryRequirementSchema);
export type Acceptance = Static<typeof AcceptanceSchema>;

/** New variants, properties and components need a story tagged `implements` (D-37, 15 §8 rule 3). */
const MustAddAcceptanceSchema = acceptance(Type.Literal('must-add'));

/** Role ids resolved through `assets.json`, outside the hash (15 §4.9). */
export const ItemAssetsSchema = Type.Object({
  before: Type.Optional(Type.String({ minLength: 1 })),
  after: Type.String({ minLength: 1 }),
});

/** What an item points at. A kind makes the keys it needs required. */
const TARGET = {
  sid: Type.Optional(SidSchema),
  vk: Type.Optional(VkSchema),
  nk: Type.Optional(Type.String({ minLength: 1 })),
  /**
   * A key for what has no `nk`: the path key of a screen or new component, the property key
   * of a `property.*` item (`arg:size`, or Figma's property id for a new one), a token's CSS name.
   */
  key: Type.Optional(Type.String({ minLength: 1 })),
  figmaNodeId: FigmaNodeIdSchema,
  /** CLI-added. */
  code: Type.Optional(CodeRefSchema),
};
export const DcrTargetSchema = Type.Object(TARGET);
export type DcrTarget = Static<typeof DcrTargetSchema>;

const target = <P extends TProperties>(required: P) => Type.Object({ ...TARGET, ...required });

/** An instance of an old or deprecated component, and what to use instead (15 §4.13). */
export const InstanceVersionRefSchema = Type.Object({
  used: Type.Object({ sid: SidSchema, vk: VkSchema, irh: DcrHashSchema, values: VariantValuesSchema }),
  current: Type.Object({ sid: SidSchema, vk: VkSchema, code: CodeRefSchema }),
  /** Old arg → new arg, from `replacedBy.args`. */
  argMap: Type.Optional(Type.Record(Type.String(), Type.String())),
  /** Old main vs current baseline. */
  visualChanges: Type.Optional(Type.Array(FieldChangeSchema)),
  /** Every usage, sorted by (screenItemId, key). */
  occurrences: Type.Array(Type.Object({ screenItemId: DcrHashSchema, key: Type.String({ minLength: 1 }) }), {
    minItems: 1,
  }),
});
export type InstanceVersionRef = Static<typeof InstanceVersionRefSchema>;

/** A property key: Holotype's (`arg:size`) for a managed property, Figma's id (`Loading#12:7`) for a new one. */
const PropertyKeySchema = Type.String({ minLength: 1 });

/** A component property (`property.*`). */
export const DcrPropertySchema = Type.Object({
  type: PropertyTypeSchema,
  /** Figma property name, e.g. `Icon` (untrusted). */
  name: UntrustedTextSchema,
  /** VARIANT axes: all values; for an added axis value, the new set of values. */
  values: Type.Optional(Type.Array(Type.String())),
  default: Type.Optional(JsonValueSchema),
  /** `property.changed`: the baseline definition (a rename keeps the key, changes the name). */
  previous: Type.Optional(
    Type.Object({
      name: Type.Optional(UntrustedTextSchema),
      values: Type.Optional(Type.Array(Type.String())),
      default: Type.Optional(JsonValueSchema),
    }),
  ),
});
export type DcrProperty = Static<typeof DcrPropertySchema>;

/** A nearest existing component (15 §4.8): at most 3, score ≥ 0.35, sorted by score then sid. */
export const NearestSchema = Type.Object({
  sid: SidSchema,
  score: Type.Number({ minimum: 0.35, maximum: 1 }),
  /** CLI-added. */
  code: Type.Optional(CodeRefSchema),
});
export type Nearest = Static<typeof NearestSchema>;

/** The API a new component proposes (15 §6). */
export const ComponentApiSchema = Type.Object({
  axes: Type.Array(Type.Object({ name: Type.String(), values: Type.Array(Type.String()), default: Type.String() })),
  properties: Type.Array(
    Type.Object({ name: Type.String(), type: PropertyTypeSchema, default: Type.Optional(JsonValueSchema) }),
  ),
});

/** A variable change (`token.*`, 08). Values per mode name; `before` absent on `token.added`. */
export const DcrVariableSchema = Type.Object({
  /** CSS custom property; for `token.added`, derived from the variable name (08 naming in reverse). */
  cssName: CssVarSchema,
  /** Figma variable name, e.g. `Space/4` (untrusted). */
  figmaName: UntrustedTextSchema,
  collection: Type.String(),
  modes: Type.Record(Type.String(), Type.Object({ before: Type.Optional(JsonValueSchema), after: JsonValueSchema })),
});
export type DcrVariable = Static<typeof DcrVariableSchema>;

// ---------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------

const ChangesSchema = Type.Array(DcrChangeSchema);

function item<K extends DcrItemKind, P extends TProperties, A extends TSchema = typeof AcceptanceSchema>(
  kind: K,
  properties: P,
  accept?: A,
) {
  return Type.Object({
    /** `h16(kind ∥ target ∥ sorted field paths)` (15 §4.9, `dcrItemId`). */
    id: DcrHashSchema,
    kind: Type.Literal(kind) as TLiteral<K>,
    /** Template-built from ids and normalized names, e.g. `Button · size=md · padding-left/right 12 → 16`. */
    title: Type.String({ minLength: 1 }),
    /** Figma property names and values as displayed; tokens by Figma name. */
    designerTitle: Type.String({ minLength: 1 }),
    notes: Type.Optional(Type.Array(DcrNoteSchema)),
    acceptance: (accept ?? AcceptanceSchema) as A,
    assets: ItemAssetsSchema,
    diagnostics: Type.Optional(Type.Array(DiagnosticSchema)),
    ...properties,
  });
}

export const ComponentModifiedItemSchema = item('component.modified', {
  target: target({ sid: SidSchema, vk: VkSchema, nk: Type.String({ minLength: 1 }) }),
  /** One item per node; field changes grouped and sorted by field. */
  changes: Type.Array(DcrChangeSchema, { minItems: 1 }),
});

export const VariantAddedItemSchema = item(
  'variant.added',
  {
    target: target({ sid: SidSchema }),
    derivedFrom: Type.Object({ vk: VkSchema, values: VariantValuesSchema }),
    variant: Type.Object({
      values: VariantValuesSchema,
      /** Arg values inferred with the inverse Title Case rule. */
      args: Type.Optional(Type.Record(Type.String(), JsonValueSchema)),
      inferred: Type.Optional(Type.Literal(true)),
    }),
    /** Against the `derivedFrom` variant. */
    changes: Type.Optional(ChangesSchema),
  },
  MustAddAcceptanceSchema,
);

export const VariantRemovedItemSchema = item('variant.removed', {
  target: target({ sid: SidSchema, vk: VkSchema }),
  variant: Type.Optional(Type.Object({ values: VariantValuesSchema })),
});

export const PropertyAddedItemSchema = item(
  'property.added',
  { target: target({ sid: SidSchema, key: PropertyKeySchema }), property: DcrPropertySchema },
  MustAddAcceptanceSchema,
);

export const PropertyChangedItemSchema = item('property.changed', {
  target: target({ sid: SidSchema, key: PropertyKeySchema }),
  property: DcrPropertySchema,
});

export const NodeAddedItemSchema = item('node.added', {
  target: target({ sid: SidSchema, vk: VkSchema }),
  /** A later copy of a duplicated `nk` (15 §4.2). */
  copiedFrom: Type.Optional(Type.String({ minLength: 1 })),
  structure: Type.Optional(Type.Array(UsageNodeRef)),
  changes: Type.Optional(ChangesSchema),
});

export const NodeRemovedItemSchema = item('node.removed', {
  target: target({ sid: SidSchema, vk: VkSchema, nk: Type.String({ minLength: 1 }) }),
});

export const ComponentNewItemSchema = item(
  'component.new',
  {
    target: target({ key: Type.String({ minLength: 1 }) }),
    structure: Type.Array(UsageNodeRef, { minItems: 1 }),
    api: ComponentApiSchema,
    /** Variant values key → deltas against `structure`. */
    variantStructure: Type.Optional(Type.Record(Type.String(), Type.Array(UsageDeltaSchema))),
    suggested: Type.Optional(
      Type.Object({
        /** Normalized, e.g. `Price tag` → `PriceTag`. */
        exportName: Type.String({ pattern: '^[A-Z][A-Za-z0-9]*$' }),
        dir: RelativePathSchema,
        files: Type.Array(Type.String({ minLength: 1 })),
      }),
    ),
    snippet: Type.Optional(UsageSnippetSchema),
    nearest: Type.Optional(Type.Array(NearestSchema, { maxItems: 3 })),
  },
  MustAddAcceptanceSchema,
);

export const ScreenItemSchema = item('screen', {
  target: target({ key: Type.String({ minLength: 1 }) }),
  screen: Type.Object({
    name: UntrustedTextSchema,
    /** Which repo builds it (15 §5.5). */
    target: Enum('components', 'screens'),
    variants: Type.Array(ScreenVariantSchema, { minItems: 1 }),
  }),
});

const instanceIssue = <K extends 'instance.detached' | 'instance.deviation'>(kind: K) =>
  item(kind, { target: target({ sid: SidSchema }), changes: Type.Optional(ChangesSchema) });
export const InstanceDetachedItemSchema = instanceIssue('instance.detached');
export const InstanceDeviationItemSchema = instanceIssue('instance.deviation');

const instanceVersion = <K extends 'instance.outdated' | 'instance.deprecated'>(kind: K) =>
  /** One item per used (sid, vk): `target.sid`/`vk` repeat `instanceRef.used`; `figmaNodeId` is the first occurrence. */
  item(kind, { target: target({ sid: SidSchema, vk: VkSchema }), instanceRef: InstanceVersionRefSchema });
export const InstanceOutdatedItemSchema = instanceVersion('instance.outdated');
export const InstanceDeprecatedItemSchema = instanceVersion('instance.deprecated');

/** A Figma variable id, e.g. `VariableID:1:23` (remote: `VariableID:<key>/1:23`). */
export const VariableIdSchema = Type.String({ pattern: '^VariableID:.+' });

const tokenItem = <K extends 'token.changed' | 'token.added'>(kind: K) =>
  item(kind, {
    /** `key` is the CSS name; `figmaNodeId` holds the variable id (variables are not nodes). */
    target: target({ key: CssVarSchema, figmaNodeId: VariableIdSchema }),
    variable: DcrVariableSchema,
  });
export const TokenChangedItemSchema = tokenItem('token.changed');
export const TokenAddedItemSchema = tokenItem('token.added');

/** A change the extractor could not classify, listed raw (DCR_UNKNOWN_CHANGE). */
export const UnknownItemSchema = item('unknown', {
  target: DcrTargetSchema,
  changes: Type.Optional(ChangesSchema),
});

/** One request item (15 §6). */
export const DcrItemSchema = Type.Union([
  ComponentModifiedItemSchema,
  VariantAddedItemSchema,
  VariantRemovedItemSchema,
  PropertyAddedItemSchema,
  PropertyChangedItemSchema,
  NodeAddedItemSchema,
  NodeRemovedItemSchema,
  ComponentNewItemSchema,
  ScreenItemSchema,
  InstanceDetachedItemSchema,
  InstanceDeviationItemSchema,
  InstanceOutdatedItemSchema,
  InstanceDeprecatedItemSchema,
  TokenChangedItemSchema,
  TokenAddedItemSchema,
  UnknownItemSchema,
]);
export type DcrItem = Static<typeof DcrItemSchema>;
/** The item of one kind, e.g. `DcrItemOf<'component.new'>`. */
export type DcrItemOf<K extends DcrItemKind> = Extract<DcrItem, { kind: K }>;
