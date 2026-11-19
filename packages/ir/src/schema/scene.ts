import { type Static, type TSchema, Type } from '@sinclair/typebox';
import {
  AssetRefSchema,
  ColorSpaceSchema,
  DiagnosticSchema,
  Enum,
  Hash16Schema,
  JsonRecordSchema,
  JsonValueSchema,
  Mat2x3Schema,
  PointSchema,
  PseudoStateSpecSchema,
  PxSchema,
  RatioSchema,
  RectSchema,
  RgbaSchema,
  RgbSchema,
  SemverSchema,
  SizeSchema,
  ViewportSchema,
} from './primitives';

/*
 * Scene IR (06 §3): the Figma-ready desired state of one component (set). Field names are
 * Plugin API names (`@figma/plugin-typings`) or documented composites (`fallback`, `expect`).
 */

/** A binding to a `tokens.json` variable. `chain` is the exact `var()` proof (D-18). */
export const VarRefSchema = Type.Object({ key: Type.String({ minLength: 1 }), confidence: Enum('chain', 'value') });
export type VarRef = Static<typeof VarRefSchema>;

export const SceneComponentRefSchema = Type.Union([
  /** A component in this bundle, or already in the file. */
  Type.Object({ kind: Type.Literal('local'), sid: Type.String({ minLength: 1 }), vk: Type.Optional(Hash16Schema) }),
  /** A published component key (`importComponentByKeyAsync`). */
  Type.Object({ kind: Type.Literal('library'), key: Type.String({ minLength: 1 }) }),
]);
export type SceneComponentRef = Static<typeof SceneComponentRefSchema>;

export const PropertyTypeSchema = Enum('VARIANT', 'BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'SLOT');
export type PropertyType = Static<typeof PropertyTypeSchema>;

/** Where a component property came from (04, D-13). */
export const PropSourceSchema = Type.Object({
  kind: Enum('arg', 'story', 'state', 'global', 'viewport', 'slot', 'synthetic'),
  argName: Type.Optional(Type.String()),
  globalName: Type.Optional(Type.String()),
  classification: PropertyTypeSchema,
  evidence: Enum('declared', 'render-diff', 'type-only'),
  /** VARIANT/BOOLEAN value ↔ arg value (Code Connect, 07). */
  valueMap: Type.Optional(Type.Array(Type.Object({ figma: Type.String(), arg: JsonValueSchema }))),
});
export type PropSource = Static<typeof PropSourceSchema>;

/**
 * Stable, Holotype-owned property key (`arg:size`, `state`, `arg:label`). The plugin maps
 * it to Figma's runtime name (`Label#4:2`) in plugin data (09 §properties).
 */
const PropertyKeySchema = Type.String({ minLength: 1 });

export const ScenePropertyDefSchema = Type.Union([
  Type.Object({
    type: Type.Literal('VARIANT'),
    key: PropertyKeySchema,
    name: Type.String(),
    values: Type.Array(Type.String(), { minItems: 1 }),
    defaultValue: Type.String(),
    source: PropSourceSchema,
  }),
  Type.Object({
    type: Type.Literal('BOOLEAN'),
    key: PropertyKeySchema,
    name: Type.String(),
    defaultValue: Type.Boolean(),
    source: PropSourceSchema,
  }),
  Type.Object({
    type: Type.Literal('TEXT'),
    key: PropertyKeySchema,
    name: Type.String(),
    defaultValue: Type.String(),
    source: PropSourceSchema,
  }),
  Type.Object({
    type: Type.Literal('INSTANCE_SWAP'),
    key: PropertyKeySchema,
    name: Type.String(),
    defaultValue: SceneComponentRefSchema,
    preferredValues: Type.Array(SceneComponentRefSchema),
    source: PropSourceSchema,
  }),
  Type.Object({
    type: Type.Literal('SLOT'),
    key: PropertyKeySchema,
    name: Type.String(),
    settings: Type.Optional(
      Type.Object({
        minChildren: Type.Optional(Type.Integer({ minimum: 0 })),
        maxChildren: Type.Optional(Type.Integer({ minimum: 0 })),
        allowPreferredValuesOnly: Type.Optional(Type.Boolean()),
      }),
    ),
    preferredValues: Type.Optional(Type.Array(SceneComponentRefSchema)),
    source: PropSourceSchema,
  }),
]);
export type ScenePropertyDef = Static<typeof ScenePropertyDefSchema>;

export const BlendModeSchema = Enum(
  'PASS_THROUGH',
  'NORMAL',
  'DARKEN',
  'MULTIPLY',
  'COLOR_BURN',
  'LIGHTEN',
  'SCREEN',
  'COLOR_DODGE',
  'OVERLAY',
  'SOFT_LIGHT',
  'HARD_LIGHT',
  'DIFFERENCE',
  'EXCLUSION',
  'HUE',
  'SATURATION',
  'COLOR',
  'LUMINOSITY',
);
export type BlendMode = Static<typeof BlendModeSchema>;

/** OKLCH/P3 provenance of a color (feature `source-color`). */
export const SourceColorSchema = Type.Object({ original: Type.String(), space: ColorSpaceSchema });

export const ScenePaintSchema = Type.Union([
  Type.Object({
    type: Type.Literal('SOLID'),
    color: RgbSchema,
    opacity: RatioSchema,
    bind: Type.Optional(VarRefSchema),
    sourceColor: Type.Optional(SourceColorSchema),
  }),
  Type.Object({
    type: Enum('GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND'),
    gradientTransform: Mat2x3Schema,
    gradientStops: Type.Array(
      Type.Object({
        position: RatioSchema,
        color: RgbaSchema,
        bind: Type.Optional(VarRefSchema),
        sourceColor: Type.Optional(SourceColorSchema),
      }),
      { minItems: 2 },
    ),
    opacity: Type.Optional(RatioSchema),
  }),
  Type.Object({
    type: Type.Literal('IMAGE'),
    asset: AssetRefSchema,
    scaleMode: Enum('FILL', 'FIT', 'CROP', 'TILE'),
    imageTransform: Type.Optional(Mat2x3Schema),
    scalingFactor: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    opacity: Type.Optional(RatioSchema),
  }),
]);
export type ScenePaint = Static<typeof ScenePaintSchema>;

const PerSide = <T extends TSchema>(item: T) => Type.Object({ t: item, r: item, b: item, l: item });
const PerSideOptional = <T extends TSchema>(item: T) =>
  Type.Object({ t: Type.Optional(item), r: Type.Optional(item), b: Type.Optional(item), l: Type.Optional(item) });

export const SceneStrokeSchema = Type.Object({
  paints: Type.Array(ScenePaintSchema),
  align: Enum('INSIDE', 'OUTSIDE', 'CENTER'),
  /** Individual weights; uniform when all are equal. */
  weight: PerSide(Type.Number({ minimum: 0 })),
  dashPattern: Type.Optional(Type.Array(Type.Number({ minimum: 0 }))),
  cap: Type.Optional(Enum('NONE', 'ROUND', 'SQUARE')),
  join: Type.Optional(Enum('MITER', 'ROUND', 'BEVEL')),
  bindWeight: Type.Optional(PerSideOptional(VarRefSchema)),
});
export type SceneStroke = Static<typeof SceneStrokeSchema>;

export const SceneEffectSchema = Type.Union([
  Type.Object({
    type: Enum('DROP_SHADOW', 'INNER_SHADOW'),
    color: RgbaSchema,
    offset: PointSchema,
    radius: Type.Number({ minimum: 0 }),
    spread: PxSchema,
    showShadowBehindNode: Type.Optional(Type.Boolean()),
    blendMode: Type.Optional(Type.Literal('NORMAL')),
    bind: Type.Optional(
      Type.Object({
        color: Type.Optional(VarRefSchema),
        radius: Type.Optional(VarRefSchema),
        spread: Type.Optional(VarRefSchema),
        offsetX: Type.Optional(VarRefSchema),
        offsetY: Type.Optional(VarRefSchema),
      }),
    ),
  }),
  Type.Object({
    type: Enum('LAYER_BLUR', 'BACKGROUND_BLUR'),
    radius: Type.Number({ minimum: 0 }),
    bind: Type.Optional(Type.Object({ radius: Type.Optional(VarRefSchema) })),
  }),
]);
export type SceneEffect = Static<typeof SceneEffectSchema>;

/** Auto-layout verification done by the mapper with `layout-sim` (D-15). */
export const LayoutVerificationSchema = Type.Object({
  /** `layout-sim` version. */
  simulator: Type.String(),
  maxDelta: Type.Number({ minimum: 0 }),
  /** Auto layout is emitted only when `maxDelta ≤ tolerance` (≤ 0.6). */
  tolerance: Type.Number({ minimum: 0 }),
  responsive: Enum('probed', 'single-snapshot'),
});
export type LayoutVerification = Static<typeof LayoutVerificationSchema>;

export const GridTrackSchema = Type.Object({ type: Enum('FIXED', 'FLEX', 'HUG'), value: Type.Optional(Type.Number()) });
export type GridTrack = Static<typeof GridTrackSchema>;

const PaddingSchema = PerSide(PxSchema);
const SizingModeSchema = Enum('FIXED', 'AUTO');

export const SceneLayoutSchema = Type.Union([
  Type.Object({
    mode: Enum('HORIZONTAL', 'VERTICAL'),
    padding: PaddingSchema,
    /** May be negative. */
    itemSpacing: PxSchema,
    /** Wrap only. */
    counterAxisSpacing: Type.Optional(PxSchema),
    wrap: Type.Boolean(),
    /** `SPACE_EVENLY`/`SPACE_AROUND` are never emitted (07 §flex). */
    primaryAxisAlignItems: Enum('MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'),
    counterAxisAlignItems: Enum('MIN', 'CENTER', 'MAX', 'BASELINE'),
    counterAxisAlignContent: Type.Optional(Enum('AUTO', 'SPACE_BETWEEN')),
    primaryAxisSizingMode: SizingModeSchema,
    counterAxisSizingMode: SizingModeSchema,
    /** D-16: false by default. */
    strokesIncludedInLayout: Type.Boolean(),
    itemReverseZIndex: Type.Boolean(),
    verified: LayoutVerificationSchema,
  }),
  Type.Object({
    mode: Type.Literal('GRID'),
    padding: PaddingSchema,
    columns: Type.Array(GridTrackSchema),
    rows: Type.Array(GridTrackSchema),
    columnGap: PxSchema,
    rowGap: PxSchema,
    primaryAxisSizingMode: SizingModeSchema,
    counterAxisSizingMode: SizingModeSchema,
    verified: LayoutVerificationSchema,
  }),
]);
export type SceneLayout = Static<typeof SceneLayoutSchema>;

/** Absolute layout that is pixel-correct by construction; applied if read-back fails (D-15). */
export const SceneFallbackSchema = Type.Object({
  /** Child `nk` → box relative to this node. */
  children: Type.Record(Type.String(), RectSchema),
  size: SizeSchema,
});
export type SceneFallback = Static<typeof SceneFallbackSchema>;

const ConstraintSchema = Enum('MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE');
const ChildSizingSchema = Enum('FIXED', 'HUG', 'FILL');
const IntentSchema = Enum('percent', 'grow', 'stretch', 'content', 'fixed');
const GridAlignSchema = Enum('MIN', 'CENTER', 'MAX', 'AUTO');
const OptionalSizeSchema = Type.Object({ w: Type.Optional(PxSchema), h: Type.Optional(PxSchema) });

/** Layout of a node as the child of an auto-layout parent. */
export const SceneChildSchema = Type.Object({
  positioning: Enum('AUTO', 'ABSOLUTE'),
  sizingH: ChildSizingSchema,
  sizingV: ChildSizingSchema,
  constraints: Type.Optional(Type.Object({ horizontal: ConstraintSchema, vertical: ConstraintSchema })),
  min: Type.Optional(OptionalSizeSchema),
  max: Type.Optional(OptionalSizeSchema),
  grid: Type.Optional(
    Type.Object({
      row: Type.Integer({ minimum: 0 }),
      col: Type.Integer({ minimum: 0 }),
      rowSpan: Type.Integer({ minimum: 1 }),
      colSpan: Type.Integer({ minimum: 1 }),
      alignH: Type.Optional(GridAlignSchema),
      alignV: Type.Optional(GridAlignSchema),
    }),
  ),
  /** For docs and Code Connect; not applied, not hashed. */
  intent: Type.Optional(Type.Object({ h: Type.Optional(IntentSchema), v: Type.Optional(IntentSchema) })),
});
export type SceneChild = Static<typeof SceneChildSchema>;

/** Not yet a Figma `FontName`: resolved in the plugin preflight (09 §fonts). */
export const SceneFontRequestSchema = Type.Object({
  /** Used (platform) family, e.g. `Inter`. */
  family: Type.String({ minLength: 1 }),
  postScriptName: Type.Optional(Type.String()),
  weight: Type.Number({ minimum: 1, maximum: 1000 }),
  italic: Type.Boolean(),
  stretch: Type.Optional(Type.String()),
  /** Ordered, e.g. `["Semi Bold", "SemiBold", "DemiBold"]`. */
  styleCandidates: Type.Array(Type.String(), { minItems: 1 }),
  /** Variable font axes. */
  variation: Type.Optional(Type.Record(Type.String(), Type.Number())),
  /** Metric-similar fallback, e.g. `Inter`. */
  fallbackFamily: Type.String({ minLength: 1 }),
  isCustom: Type.Boolean(),
});
export type SceneFontRequest = Static<typeof SceneFontRequestSchema>;

export const SceneTextRangeSchema = Type.Object({
  start: Type.Integer({ minimum: 0 }),
  end: Type.Integer({ minimum: 0 }),
  font: SceneFontRequestSchema,
  fontSize: Type.Number({ exclusiveMinimum: 0 }),
  /** Never `AUTO` (D-17). */
  lineHeight: Type.Object({ unit: Type.Literal('PIXELS'), value: PxSchema }),
  letterSpacing: Type.Object({ unit: Type.Literal('PIXELS'), value: PxSchema }),
  textCase: Enum('ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS'),
  decoration: Enum('NONE', 'UNDERLINE', 'STRIKETHROUGH'),
  decorationStyle: Type.Optional(Enum('SOLID', 'WAVY', 'DOTTED')),
  decorationColor: Type.Optional(ScenePaintSchema),
  decorationThickness: Type.Optional(PxSchema),
  decorationOffset: Type.Optional(PxSchema),
  fills: Type.Array(ScenePaintSchema),
  hyperlink: Type.Optional(Type.String()),
  openTypeFeatures: Type.Optional(Type.Record(Type.String(), Type.Boolean())),
  bind: Type.Optional(
    Type.Object({
      fontSize: Type.Optional(VarRefSchema),
      fontFamily: Type.Optional(VarRefSchema),
      fontWeight: Type.Optional(VarRefSchema),
      lineHeight: Type.Optional(VarRefSchema),
      letterSpacing: Type.Optional(VarRefSchema),
    }),
  ),
});
export type SceneTextRange = Static<typeof SceneTextRangeSchema>;

export const SceneTextSchema = Type.Object({
  /** `\n` = paragraph, U+2028 = line separator. */
  characters: Type.String(),
  autoResize: Enum('WIDTH_AND_HEIGHT', 'HEIGHT', 'NONE', 'TRUNCATE'),
  /** `textTruncation: ENDING`. */
  truncation: Type.Optional(Type.Object({ maxLines: Type.Integer({ minimum: 1 }) })),
  alignH: Enum('LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'),
  alignV: Enum('TOP', 'CENTER', 'BOTTOM'),
  wrapStyle: Type.Optional(Enum('AUTO', 'BALANCE', 'PRETTY')),
  paragraphIndent: Type.Optional(PxSchema),
  paragraphSpacing: Type.Optional(PxSchema),
  leadingTrim: Type.Optional(Enum('NONE', 'CAP_HEIGHT')),
  /** Cover `[0, characters.length)` without gaps, sorted by `start`. */
  ranges: Type.Array(SceneTextRangeSchema),
  /** Browser line breaks: locked-lines mode and the parity check. */
  lines: Type.Array(Type.Object({ startChar: Type.Integer({ minimum: 0 }), endChar: Type.Integer({ minimum: 0 }) })),
  wrapMode: Enum('reflow', 'locked-lines'),
  /** The plugin may widen the box up to this to restore line parity (07 §text). */
  widthBuffer: Type.Object({ max: Type.Number({ minimum: 0 }) }),
  /** Text style to apply (08). */
  styleRef: Type.Optional(Type.Object({ kind: Enum('local', 'library'), key: Type.String({ minLength: 1 }) })),
});
export type SceneText = Static<typeof SceneTextSchema>;

/** Node-level `setBoundVariable` fields. */
export const SceneBindingsSchema = Type.Object({
  width: Type.Optional(VarRefSchema),
  height: Type.Optional(VarRefSchema),
  itemSpacing: Type.Optional(VarRefSchema),
  counterAxisSpacing: Type.Optional(VarRefSchema),
  paddingTop: Type.Optional(VarRefSchema),
  paddingRight: Type.Optional(VarRefSchema),
  paddingBottom: Type.Optional(VarRefSchema),
  paddingLeft: Type.Optional(VarRefSchema),
  topLeftRadius: Type.Optional(VarRefSchema),
  topRightRadius: Type.Optional(VarRefSchema),
  bottomRightRadius: Type.Optional(VarRefSchema),
  bottomLeftRadius: Type.Optional(VarRefSchema),
  minWidth: Type.Optional(VarRefSchema),
  maxWidth: Type.Optional(VarRefSchema),
  minHeight: Type.Optional(VarRefSchema),
  maxHeight: Type.Optional(VarRefSchema),
  opacity: Type.Optional(VarRefSchema),
  visible: Type.Optional(VarRefSchema),
  characters: Type.Optional(VarRefSchema),
  gridRowGap: Type.Optional(VarRefSchema),
  gridColumnGap: Type.Optional(VarRefSchema),
  /** `setExplicitVariableModeForCollection` (theme variants). */
  explicitModes: Type.Optional(Type.Array(Type.Object({ collection: Type.String(), mode: Type.String() }))),
});
export type SceneBindings = Static<typeof SceneBindingsSchema>;

export const SceneNodeKindSchema = Enum(
  'component',
  'frame',
  'group',
  'rectangle',
  'ellipse',
  'text',
  'vector',
  'svg',
  'image',
  'instance',
);
export type SceneNodeKind = Static<typeof SceneNodeKindSchema>;

/** Property keys a node's fields are bound to (`componentPropertyReferences`). */
export const ScenePropRefsSchema = Type.Object({
  characters: Type.Optional(Type.String()),
  visible: Type.Optional(Type.String()),
  mainComponent: Type.Optional(Type.String()),
});

const sceneInstance = <T extends TSchema>(node: T) =>
  Type.Object({
    /** The main component or variant. */
    component: SceneComponentRefSchema,
    /** Keyed by the referenced component's `ScenePropertyDef.key`. */
    properties: Type.Record(Type.String(), Type.Union([Type.String(), Type.Boolean(), SceneComponentRefSchema])),
    /** Last resort; prefer properties. */
    overrides: Type.Optional(
      Type.Array(
        Type.Object({
          nk: Type.String(),
          fields: Type.Object({
            visible: Type.Optional(Type.Boolean()),
            fills: Type.Optional(Type.Array(ScenePaintSchema)),
            opacity: Type.Optional(RatioSchema),
            characters: Type.Optional(Type.String()),
          }),
        }),
      ),
    ),
    /** D-21 evidence; not hashed. */
    match: Type.Object({ method: Enum('reference', 'name', 'structural'), maxDelta: Type.Number({ minimum: 0 }) }),
    /** Frame subtree built when the instance does not match (09 §10). */
    fallback: Type.Optional(node),
  });

/** One Scene IR node (06 §3.3). Recursive through `children` and `instance.fallback`. */
export const SceneNodeSchema = Type.Recursive(
  (This) =>
    Type.Object({
      /** Node key, aligned across variants (07 §alignment). */
      nk: Type.String({ minLength: 1 }),
      kind: SceneNodeKindSchema,
      /** Layer name, unique among siblings (07 §naming). */
      name: Type.String(),
      irh: Hash16Schema,
      /** Resize target. */
      size: SizeSchema,
      /** Only when rotated, skewed or scaled; otherwise the position comes from `xy`. */
      relativeTransform: Type.Optional(Mat2x3Schema),
      /** Relative to the parent; when the parent is absolute or the node is ABSOLUTE. */
      xy: Type.Optional(PointSchema),
      /** Expected `absoluteBoundingBox` relative to the variant root (read-back, D-15). Not hashed. */
      expect: RectSchema,
      visible: Type.Boolean(),
      /** Omitted = 1. */
      opacity: Type.Optional(RatioSchema),
      /** Omitted = PASS_THROUGH (frames) / NORMAL (others). */
      blendMode: Type.Optional(BlendModeSchema),
      isMask: Type.Optional(Type.Boolean()),
      maskType: Type.Optional(Enum('ALPHA', 'VECTOR', 'LUMINANCE')),
      clipsContent: Type.Optional(Type.Boolean()),
      /** Figma order: bottom → top. `[]` means "no fill". */
      fills: Type.Optional(Type.Array(ScenePaintSchema)),
      strokes: Type.Optional(SceneStrokeSchema),
      radius: Type.Optional(
        Type.Object({
          tl: Type.Number({ minimum: 0 }),
          tr: Type.Number({ minimum: 0 }),
          br: Type.Number({ minimum: 0 }),
          bl: Type.Number({ minimum: 0 }),
          smoothing: Type.Optional(Type.Literal(0)),
        }),
      ),
      effects: Type.Optional(Type.Array(SceneEffectSchema)),
      /** Absent = `layoutMode: NONE` (children placed by `xy`). */
      layout: Type.Optional(SceneLayoutSchema),
      /** Required when `layout` is present (D-15). */
      fallback: Type.Optional(SceneFallbackSchema),
      child: Type.Optional(SceneChildSchema),
      text: Type.Optional(SceneTextSchema),
      vector: Type.Optional(
        Type.Object({
          paths: Type.Array(Type.Object({ windingRule: Enum('NONZERO', 'EVENODD'), data: Type.String() })),
        }),
      ),
      /** `createNodeFromSvg(asset)`; `unwrap` lifts the single child out of the wrapper frame. */
      svg: Type.Optional(Type.Object({ asset: AssetRefSchema, unwrap: Type.Boolean() })),
      /** Images are IMAGE paints in `fills`. */
      image: Type.Optional(Type.Never()),
      instance: Type.Optional(sceneInstance(This)),
      bind: Type.Optional(SceneBindingsSchema),
      propRefs: Type.Optional(ScenePropRefsSchema),
      /** This frame is the SLOT for property `propKey` (`createSlot`). */
      slot: Type.Optional(Type.Object({ propKey: Type.String({ minLength: 1 }) })),
      /** Paint order bottom → top, which is Figma child order. */
      children: Type.Optional(Type.Array(This)),
      /** Provenance; not hashed. */
      source: Type.Optional(
        Type.Object({ path: Type.String(), tag: Type.String(), component: Type.Optional(Type.String()) }),
      ),
      /** Not hashed. */
      diagnostics: Type.Optional(Type.Array(DiagnosticSchema)),
    }),
  { $id: 'SceneNode' },
);
export type SceneNode = Static<typeof SceneNodeSchema>;
export type SceneInstance = NonNullable<SceneNode['instance']>;

export const SceneVariantSchema = Type.Object({
  vk: Hash16Schema,
  /** `H(values, root.irh)` (06 §6). */
  irh: Hash16Schema,
  /** VARIANT property key → value; the Figma name is `Size=Large, State=Hover`. */
  values: Type.Record(Type.String(), Type.String()),
  /** The render that produced this variant. Not hashed. */
  provenance: Type.Object({
    storyId: Type.String({ minLength: 1 }),
    args: JsonRecordSchema,
    globals: JsonRecordSchema,
    state: Type.Union([PseudoStateSpecSchema, Type.Null()]),
    viewport: ViewportSchema,
    captureHash: Type.String(),
  }),
  /** Position in the set grid. */
  grid: Type.Object({ row: Type.Integer({ minimum: 0 }), col: Type.Integer({ minimum: 0 }) }),
  /** `kind: 'component'`. */
  root: SceneNodeSchema,
  /** Filled by fidelity harness runs (12). Not hashed. */
  fidelity: Type.Optional(
    Type.Object({ ssim: Type.Optional(RatioSchema), maxBoxDelta: Type.Optional(Type.Number({ minimum: 0 })) }),
  ),
  diagnostics: Type.Array(DiagnosticSchema),
});
export type SceneVariant = Static<typeof SceneVariantSchema>;

/** Variants sit at x/y from `SceneVariant.grid`; the set has no auto layout (06 §3.2). */
export const SceneSetLayoutSchema = Type.Object({
  mode: Type.Literal('grid'),
  /** VARIANT keys mapped to columns (product order). */
  columnsBy: Type.Array(Type.String()),
  /** VARIANT keys mapped to rows. */
  rowsBy: Type.Array(Type.String()),
  /** From `figma.grid.gap` (16), default 24/24. */
  gap: PointSchema,
  /** From `figma.grid.padding` (16), default 32. */
  padding: Type.Number({ minimum: 0 }),
  /** Row/column labels: managed TEXT nodes in the Section, outside the set. */
  labels: Type.Boolean(),
});
export type SceneSetLayout = Static<typeof SceneSetLayoutSchema>;

export const SceneDocFrameSchema = Type.Object({
  title: Type.String(),
  description: Type.String(),
  storybookUrl: Type.Optional(Type.String()),
  /** Per grid track. */
  axisLabels: Type.Object({
    columns: Type.Array(Type.Array(Type.String())),
    rows: Type.Array(Type.Array(Type.String())),
  }),
  /** Intentionally absent: no timestamps in hashed content (06 §5). */
  generatedAt: Type.Optional(Type.Never()),
});
export type SceneDocFrame = Static<typeof SceneDocFrameSchema>;

export const SceneComponentMetaSchema = Type.Object({
  /** Figma component set name (`Button`). */
  name: Type.String({ minLength: 1 }),
  /** `["Components", "Forms", "Button"]` → section placement (D-22). */
  titlePath: Type.Array(Type.String()),
  /** Figma description, plain text. */
  description: Type.String(),
  descriptionSource: Enum('manifest', 'docgen', 'parameters', 'none'),
  /** Storybook docs/story URLs → `documentationLinks`. */
  links: Type.Array(Type.Object({ label: Type.String(), url: Type.String() })),
  storyIds: Type.Array(Type.String(), { minItems: 1 }),
  importPath: Type.Optional(Type.String()),
  exportName: Type.Optional(Type.String()),
  componentPath: Type.Optional(Type.String()),
  framework: Type.Optional(Type.String()),
  /** A single-variant component is a plain COMPONENT. */
  kind: Enum('component-set', 'component'),
});
export type SceneComponentMeta = Static<typeof SceneComponentMetaSchema>;

/** Scene IR document: one per component (06 §3), `components/<sid>.json` in a bundle. */
export const SceneComponentSchema = Type.Object(
  {
    kind: Type.Literal('holotype/scene-component'),
    sceneVersion: SemverSchema,
    /** Component id (D-19). */
    sid: Type.String({ minLength: 1 }),
    /** Merkle hash of the whole component (06 §6). */
    irh: Hash16Schema,
    meta: SceneComponentMetaSchema,
    /** Display order. */
    properties: Type.Array(ScenePropertyDefSchema),
    /** Sorted by grid position `(row, col)`. */
    variants: Type.Array(SceneVariantSchema, { minItems: 1 }),
    setLayout: SceneSetLayoutSchema,
    docFrame: Type.Optional(SceneDocFrameSchema),
    /** Sids this component instantiates (topological build order, 09). */
    dependencies: Type.Array(Type.String()),
    diagnostics: Type.Array(DiagnosticSchema),
  },
  { title: 'Holotype Scene IR (SceneComponent)' },
);
export type SceneComponent = Static<typeof SceneComponentSchema>;

/** Schemas a `SceneComponent` refers to by `$id`. */
export const SCENE_REFERENCES = [SceneNodeSchema] as const;
