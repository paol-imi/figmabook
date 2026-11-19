import { Enum, JsonValueSchema, KeyedRecord, PropertyTypeSchema } from '@holotype/ir';
import { type Static, Type } from '@sinclair/typebox';
import {
  CommitSchema,
  DcrHashSchema,
  FigmaNodeIdSchema,
  GroupSchema,
  SidSchema,
  UntrustedTextSchema,
  VariantValuesSchema,
  VkSchema,
} from './primitives';
import { DcrScopeSchema } from './scope';

/*
 * The extractor's inputs (15 §3.3, §4.1, §4.3): the normalized Figma read-back and the
 * baseline embedded at apply time. Both use the `ah` normalizer of `@holotype/ir`
 * (`normalizeGroups`), so Figma's own float noise never shows up as a change.
 */

/**
 * Normalized property groups of one node (15 §3.3): the `normalizeGroups` output, where an
 * absent group means "not read" (a snapshot may omit groups whose sub-hash still matches).
 */
export const NodeGroupsSchema = Type.Object(
  {
    geom: Type.Optional(JsonValueSchema),
    layout: Type.Optional(JsonValueSchema),
    paint: Type.Optional(JsonValueSchema),
    text: Type.Optional(JsonValueSchema),
    vis: Type.Optional(JsonValueSchema),
    bind: Type.Optional(JsonValueSchema),
    inst: Type.Optional(JsonValueSchema),
  },
  // The seven groups are a closed set (06 §6): an unknown group is a bad value, not a future field.
  { additionalProperties: false },
);
/** `NodeGroups` of 15 §3.3; `@holotype/ir`'s `NodeGroups` (all seven groups) is assignable to it. */
export type PartialNodeGroups = Static<typeof NodeGroupsSchema>;

/** One field-level difference (15 §4.3). `before`/`after` are Figma values, never CSS. */
export const FieldChangeSchema = Type.Object({
  group: GroupSchema,
  /**
   * Figma read-back path inside its group, prefixed by the group: `layout.paddingLeft`,
   * `paint.fills[0].color`, `bind.paddingLeft`, `layout.children.order`.
   */
  field: Type.String({ pattern: '^(?:geom|layout|paint|text|vis|bind|inst)\\..+' }),
  before: JsonValueSchema,
  after: JsonValueSchema,
});
export type FieldChange = Static<typeof FieldChangeSchema>;

/** One variant axis as stored in the set's `axes` plugin data (10 §2.1). */
export const SnapAxisSchema = Type.Object({
  name: Type.String(),
  /** Holotype property key, e.g. `arg:size`. */
  key: Type.String({ minLength: 1 }),
  values: Type.Array(Type.String()),
});
export type SnapAxis = Static<typeof SnapAxisSchema>;

/** A set's property and axes snapshot (15 §3.3 `props`, 10 §2.1 `axes`/`props`). */
export const SetPropsSnapshotSchema = Type.Object({
  axes: Type.Array(SnapAxisSchema),
  /** Holotype property key → definition as applied. */
  properties: Type.Record(
    Type.String({ minLength: 1 }),
    Type.Object({
      /** Figma's persisted property id, e.g. `Show icon#12:3`. */
      id: Type.String({ minLength: 1 }),
      type: PropertyTypeSchema,
      default: Type.Optional(JsonValueSchema),
    }),
  ),
});
export type SetPropsSnapshot = Static<typeof SetPropsSnapshotSchema>;

/** The baseline of one variant (`base:*` plugin data, 15 §3.3, D-34). */
export const BaselineSnapshotSchema = Type.Object(
  {
    v: Type.Literal(1),
    vk: VkSchema,
    sid: SidSchema,
    baseCommit: CommitSchema,
    /** Bundle fingerprint applied as the baseline. */
    baselineFp: DcrHashSchema,
    /** `nk` → normalized groups, exactly as applied (after verification and fallback). */
    nodes: Type.Record(Type.String({ minLength: 1 }), NodeGroupsSchema),
    /** Parent `nk` → managed child `nk`s in order. */
    order: Type.Record(Type.String({ minLength: 1 }), Type.Array(Type.String({ minLength: 1 }))),
    /** On the set's snapshot only. */
    props: Type.Optional(SetPropsSnapshotSchema),
  },
  { title: 'Holotype baseline snapshot (BaselineSnapshot)' },
);
export type BaselineSnapshot = Static<typeof BaselineSnapshotSchema>;

/** One instance property as read back (Plugin API `componentProperties`). */
export const SnapInstancePropertySchema = Type.Object({
  type: PropertyTypeSchema,
  value: JsonValueSchema,
});

/** One node of the normalized Figma read-back (15 §4.1). Instance sublayers are skipped. */
export const SnapNodeSchema = Type.Object({
  id: FigmaNodeIdSchema,
  /** Figma node type, e.g. `FRAME`, `COMPONENT`, `INSTANCE`, `TEXT`. */
  type: Type.String({ minLength: 1 }),
  name: UntrustedTextSchema,
  parent: Type.Optional(FigmaNodeIdSchema),
  children: Type.Optional(Type.Array(FigmaNodeIdSchema)),
  /** `holotype` shared plugin data: `sid`, `vk`, `nk`, `ah`, `base:*`, `lock`, … */
  data: Type.Record(Type.String(), Type.String()),
  groups: NodeGroupsSchema,
  component: Type.Optional(
    Type.Object({
      setId: Type.Optional(FigmaNodeIdSchema),
      variantValues: Type.Optional(VariantValuesSchema),
      propertyDefs: Type.Optional(JsonValueSchema),
    }),
  ),
  instance: Type.Optional(
    Type.Object({
      mainKey: Type.Optional(Type.String()),
      mainId: Type.Optional(FigmaNodeIdSchema),
      /** Figma property id → value. */
      properties: Type.Record(Type.String(), SnapInstancePropertySchema),
      /** Sublayers with overrides and the overridden fields. */
      overrides: Type.Array(Type.Object({ id: FigmaNodeIdSchema, fields: Type.Array(Type.String()) })),
    }),
  ),
  detachedInfo: Type.Optional(
    Type.Union([
      Type.Object({ type: Type.Literal('local'), componentId: FigmaNodeIdSchema }),
      Type.Object({ type: Type.Literal('library'), componentKey: Type.String({ minLength: 1 }) }),
    ]),
  ),
  devStatus: Type.Optional(Enum('READY_FOR_DEV', 'COMPLETED')),
  annotations: Type.Optional(
    Type.Array(Type.Object({ label: UntrustedTextSchema, category: Type.Optional(Type.String()) })),
  ),
});
export type SnapNode = Static<typeof SnapNodeSchema>;

/** One variable as read back (15 §4.7, 08). */
export const SnapVariableSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  /** Figma variable name, e.g. `Space/4` (untrusted). */
  name: UntrustedTextSchema,
  collection: Type.String(),
  resolvedType: Enum('COLOR', 'FLOAT', 'STRING', 'BOOLEAN'),
  /** Mode id → normalized value or alias `{ alias: <variable id> }`. */
  valuesByMode: Type.Record(Type.String(), JsonValueSchema),
  /** `codeSyntax.WEB`, e.g. `var(--space-4)`. */
  codeSyntax: Type.Optional(Type.Object({ WEB: Type.Optional(Type.String()) })),
  /** Library key, for remote variables. */
  key: Type.Optional(Type.String()),
  remote: Type.Optional(Type.Boolean()),
  /** `holotype` shared plugin data (`tok`, `ah`, `v`). */
  data: Type.Record(Type.String(), Type.String()),
});
export type SnapVariable = Static<typeof SnapVariableSchema>;

/** The normalized Figma read-back the extractor diffs (15 §4.1). Plugin and REST give the same bytes. */
export const FigmaSnapshotSchema = Type.Object(
  {
    kind: Type.Literal('holotype/figma-snapshot'),
    v: Type.Literal(1),
    source: Enum('plugin', 'rest'),
    fileKey: Type.String({ minLength: 1 }),
    /** The named version saved at Submit (D-48). */
    fileVersion: Type.Optional(Type.String()),
    scope: DcrScopeSchema,
    pages: Type.Array(
      Type.Object({ id: FigmaNodeIdSchema, name: UntrustedTextSchema, topLevel: Type.Array(FigmaNodeIdSchema) }),
    ),
    nodes: KeyedRecord(FigmaNodeIdSchema, SnapNodeSchema),
    variables: Type.Record(Type.String(), SnapVariableSchema),
    /** `figma.root` shared plugin data (`branch:meta`, registry chunks). */
    rootData: Type.Record(Type.String(), Type.String()),
  },
  { title: 'Holotype Figma snapshot (FigmaSnapshot)' },
);
export type FigmaSnapshot = Static<typeof FigmaSnapshotSchema>;
