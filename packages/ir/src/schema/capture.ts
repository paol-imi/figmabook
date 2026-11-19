import { type Static, Type } from '@sinclair/typebox';
import {
  AssetRefSchema,
  ColorSchema,
  Corners,
  DiagnosticSchema,
  Enum,
  Hash16Schema,
  JsonRecordSchema,
  KeyedRecord,
  Mat2x3Schema,
  PseudoStateSpecSchema,
  PxSchema,
  QuadSchema,
  RatioSchema,
  RectSchema,
  RefTo,
  SemverSchema,
  Sha256Schema,
  Sides,
  SourceLocSchema,
} from './primitives';

/*
 * Capture IR (06 §2): raw browser facts for one variant, never a Figma decision.
 * Produced by `capture`, consumed by `mapper`; cache-only (never sent to the plugin).
 */

const NaturalSizeSchema = Type.Object({ w: Type.Number({ minimum: 0 }), h: Type.Number({ minimum: 0 }) });

export const NativeControlSchema = Enum(
  'text',
  'checkbox',
  'radio',
  'select',
  'range',
  'progress',
  'meter',
  'textarea',
  'button',
  'file',
  'color',
  'date',
);
export type NativeControl = Static<typeof NativeControlSchema>;

export const CSourceSchema = Type.Object({
  /** Lowercase tag; `::before` for pseudo-elements. */
  tag: Type.String(),
  /** Composed path, e.g. `div:0>button.btn:0>span:1` (05 §path). */
  path: Type.String(),
  classes: Type.Optional(Type.Array(Type.String(), { maxItems: 16 })),
  id: Type.Optional(Type.String()),
  /** `data-testid`, `data-test` or `data-cy`. */
  testId: Type.Optional(Type.String()),
  /** `data-holotype-name` (alias `data-figma-name`). */
  figmaName: Type.Optional(Type.String()),
  /** `data-holotype-key` (alias `data-figma-key`): an explicit `nk` hint. */
  figmaKey: Type.Optional(Type.String()),
  role: Type.Optional(Type.String()),
  ariaLabel: Type.Optional(Type.String()),
  component: Type.Optional(
    Type.Object({ name: Type.String(), framework: Type.String(), boundaryId: Type.Optional(Type.String()) }),
  ),
  inShadow: Type.Optional(Type.Boolean()),
  shadowHost: Type.Optional(Type.Boolean()),
  slotName: Type.Optional(Type.String()),
  pseudo: Type.Optional(Enum('before', 'after', 'marker', 'placeholder')),
  nativeControl: Type.Optional(NativeControlSchema),
  /** Visually hidden; the mapper drops it. */
  srOnly: Type.Optional(Type.Boolean()),
  /** JSX location from `data-holotype-loc` (05 §6.2, 15 §5.1). */
  loc: Type.Optional(SourceLocSchema),
});
export type CSource = Static<typeof CSourceSchema>;

export const CStopSchema = Type.Object({
  /** 0..1 along the gradient line. */
  offset: RatioSchema,
  color: ColorSchema,
});
export type CStop = Static<typeof CStopSchema>;

export const CShadowSchema = Type.Object({
  inset: Type.Boolean(),
  x: PxSchema,
  y: PxSchema,
  blur: PxSchema,
  spread: PxSchema,
  color: ColorSchema,
});
export type CShadow = Static<typeof CShadowSchema>;

const CenterSchema = Type.Object({ x: PxSchema, y: PxSchema });

export const CBackgroundImageSchema = Type.Union([
  Type.Object({ kind: Type.Literal('url'), asset: AssetRefSchema, natural: NaturalSizeSchema }),
  Type.Object({
    kind: Type.Literal('linear'),
    css: Type.String(),
    angleDeg: Type.Number(),
    stops: Type.Array(CStopSchema),
    repeating: Type.Boolean(),
    interpolation: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal('radial'),
    css: Type.String(),
    shape: Enum('circle', 'ellipse'),
    center: CenterSchema,
    radii: CenterSchema,
    stops: Type.Array(CStopSchema),
    repeating: Type.Boolean(),
  }),
  Type.Object({
    kind: Type.Literal('conic'),
    css: Type.String(),
    fromDeg: Type.Number(),
    center: CenterSchema,
    stops: Type.Array(CStopSchema),
    repeating: Type.Boolean(),
  }),
]);

/** One background layer, CSS order (first = topmost). */
export const CBackgroundLayerSchema = Type.Object({
  image: CBackgroundImageSchema,
  size: Type.String(),
  position: Type.String(),
  repeat: Type.String(),
  origin: Type.String(),
  clip: Type.String(),
  attachment: Type.String(),
});
export type CBackgroundLayer = Static<typeof CBackgroundLayerSchema>;

/** `getComputedStyle` facts for an element or pseudo-element (05 §style-diff). */
export const CComputedSchema = Type.Object({
  display: Type.String(),
  position: Type.String(),
  boxSizing: Type.String(),
  visibility: Type.String(),
  zIndex: Type.String(),
  opacity: RatioSchema,
  mixBlendMode: Type.String(),
  isolation: Type.String(),
  overflowX: Type.String(),
  overflowY: Type.String(),
  padding: Sides(PxSchema),
  border: Type.Object({ width: Sides(PxSchema), style: Sides(Type.String()), color: Sides(ColorSchema) }),
  margin: Sides(PxSchema),
  /** Elliptical radii are preserved (h ≠ v). */
  radius: Type.Object({ h: Corners(PxSchema), v: Corners(PxSchema) }),
  outline: Type.Optional(Type.Object({ width: PxSchema, style: Type.String(), color: ColorSchema, offset: PxSchema })),
  background: Type.Object({
    color: ColorSchema,
    layers: Type.Array(CBackgroundLayerSchema),
    clip: Type.Array(Type.String()),
  }),
  /** Parsed, CSS order (first = topmost). */
  boxShadow: Type.Array(CShadowSchema),
  filter: Type.Optional(Type.String()),
  backdropFilter: Type.Optional(Type.String()),
  clipPath: Type.Optional(Type.String()),
  maskImage: Type.Optional(Type.String()),
  transformOrigin: Type.Optional(Type.String()),
  flex: Type.Optional(
    Type.Object({
      direction: Type.String(),
      wrap: Type.String(),
      justify: Type.String(),
      alignItems: Type.String(),
      alignContent: Type.String(),
      rowGap: PxSchema,
      columnGap: PxSchema,
    }),
  ),
  item: Type.Optional(
    Type.Object({
      grow: Type.Number(),
      shrink: Type.Number(),
      basis: Type.String(),
      alignSelf: Type.String(),
      justifySelf: Type.String(),
      order: Type.Number(),
    }),
  ),
  grid: Type.Optional(
    Type.Object({
      templateColumns: Type.String(),
      templateRows: Type.String(),
      columnsPx: Type.Array(PxSchema),
      rowsPx: Type.Array(PxSchema),
      areas: Type.Optional(Type.String()),
      autoFlow: Type.String(),
      columnStart: Type.String(),
      columnEnd: Type.String(),
      rowStart: Type.String(),
      rowEnd: Type.String(),
      justifyItems: Type.String(),
      alignItems: Type.String(),
    }),
  ),
  insets: Type.Optional(
    Type.Object({ top: Type.String(), right: Type.String(), bottom: Type.String(), left: Type.String() }),
  ),
  size: Type.Object({
    width: PxSchema,
    height: PxSchema,
    minW: Type.String(),
    maxW: Type.String(),
    minH: Type.String(),
    maxH: Type.String(),
  }),
  /** For `currentColor` and SVG. */
  color: ColorSchema,
  textAlign: Type.Optional(Type.String()),
  direction: Type.Optional(Type.String()),
  writingMode: Type.Optional(Type.String()),
});
export type CComputed = Static<typeof CComputedSchema>;

export const CLengthIntentSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('keyword'),
    value: Enum('auto', 'fit-content', 'min-content', 'max-content', 'stretch', 'none'),
  }),
  Type.Object({ kind: Type.Literal('px'), value: PxSchema }),
  Type.Object({ kind: Type.Literal('percent'), value: Type.Number(), resolvedPx: PxSchema }),
  Type.Object({ kind: Type.Literal('calc'), expr: Type.String(), resolvedPx: PxSchema }),
  Type.Object({ kind: Type.Literal('other'), text: Type.String() }),
]);
export type CLengthIntent = Static<typeof CLengthIntentSchema>;

/** A `var()` chain, e.g. `var(--btn-bg)` → `var(--color-primary-500)` → `#3b82f6` (08 §resolution). */
export const CVarChainSchema = Type.Object({
  property: Type.String(),
  /** The declared value text. */
  authored: Type.String(),
  chain: Type.Array(Type.String({ pattern: '^--' })),
  /** True iff the value equals the last variable's value with no calc, color-mix or fallback. */
  pure: Type.Boolean(),
  fallbackUsed: Type.Optional(Type.Boolean()),
});
export type CVarChain = Static<typeof CVarChainSchema>;

/** The winning rule of a CSS property (branch mode, 05 §6.2); CDP ranges are 0-based. */
export const CRuleRefSchema = Type.Object({
  /** As served; may be a hashed CSS-module class. */
  selector: Type.String(),
  /** Key into `CaptureDoc.styleSheets`. */
  styleSheetId: Type.String(),
  range: Type.Object({
    startLine: Type.Integer({ minimum: 0 }),
    startColumn: Type.Integer({ minimum: 0 }),
    endLine: Type.Integer({ minimum: 0 }),
    endColumn: Type.Integer({ minimum: 0 }),
  }),
});
export type CRuleRef = Static<typeof CRuleRefSchema>;

/** Authored intent the computed style loses (07 §sizing). */
export const CAuthoredSchema = Type.Object({
  width: Type.Optional(CLengthIntentSchema),
  height: Type.Optional(CLengthIntentSchema),
  minWidth: Type.Optional(CLengthIntentSchema),
  maxWidth: Type.Optional(CLengthIntentSchema),
  minHeight: Type.Optional(CLengthIntentSchema),
  maxHeight: Type.Optional(CLengthIntentSchema),
  /** Authored `flex: 1` vs `1 1 auto`. */
  flexShorthand: Type.Optional(Type.String()),
  gridTemplateColumns: Type.Optional(Type.String()),
  gridTemplateRows: Type.Optional(Type.String()),
  /** Any `@media` or `@container` rule matched this node. */
  hasMediaQueries: Type.Optional(Type.Boolean()),
  /** CSS property → `var()` chain. */
  varRefs: Type.Optional(Type.Record(Type.String(), CVarChainSchema)),
  /** CSS property → winning rule location (branch mode only). */
  rules: Type.Optional(Type.Record(Type.String(), CRuleRefSchema)),
});
export type CAuthored = Static<typeof CAuthoredSchema>;

export const CTextSchema = Type.Object({
  /** Source characters before `text-transform`; `\n` = paragraph, U+2028 = `<br>`. */
  characters: Type.String(),
  runs: Type.Array(
    Type.Object({
      start: Type.Integer({ minimum: 0 }),
      end: Type.Integer({ minimum: 0 }),
      styleId: Type.String(),
      href: Type.Optional(Type.String()),
      /** CNode id with `background-clip: text`. */
      gradientFrom: Type.Optional(Type.String()),
    }),
  ),
  /** Browser line boxes: the truth the text checks compare against. */
  lines: Type.Array(
    Type.Object({
      top: PxSchema,
      height: PxSchema,
      baseline: Type.Optional(PxSchema),
      startChar: Type.Integer({ minimum: 0 }),
      endChar: Type.Integer({ minimum: 0 }),
      left: PxSchema,
      width: PxSchema,
    }),
  ),
  whiteSpace: Type.String(),
  textOverflow: Type.String(),
  lineClamp: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  wrap: Enum('wrap', 'nowrap', 'balance', 'pretty'),
  /** `start`/`end` already resolved through `direction`. */
  textAlign: Enum('left', 'right', 'center', 'justify'),
  indent: PxSchema,
  /** Inline backgrounds and borders (`code`, `mark`). */
  inlineDecorations: Type.Optional(
    Type.Array(Type.Object({ nodeId: Type.String(), fragments: Type.Array(RectSchema) })),
  ),
  /** Unicode scripts present, for the fallback-font split. */
  scripts: Type.Optional(Type.Array(Type.String())),
});
export type CText = Static<typeof CTextSchema>;

export const CTextStyleSchema = Type.Object({
  cssFamily: Type.String(),
  /** `CSS.getPlatformFontsForNode`, by glyph count descending. */
  used: Type.Array(
    Type.Object({
      family: Type.String(),
      postScriptName: Type.String(),
      isCustom: Type.Boolean(),
      glyphCount: Type.Integer({ minimum: 0 }),
    }),
  ),
  weight: Type.Number(),
  italic: Type.Boolean(),
  stretch: Type.String(),
  variation: Type.Optional(Type.Record(Type.String(), Type.Number())),
  features: Type.Optional(Type.Record(Type.String(), Type.Number())),
  synthetic: Type.Optional(Type.Array(Enum('bold', 'italic'))),
  size: PxSchema,
  lineHeightPx: PxSchema,
  lineHeightSource: Enum('explicit', 'normal-measured', 'normal-probed'),
  letterSpacingPx: PxSchema,
  wordSpacingPx: PxSchema,
  transform: Enum('none', 'uppercase', 'lowercase', 'capitalize'),
  smallCaps: Type.Boolean(),
  decoration: Type.Optional(
    Type.Object({
      lines: Type.Array(Enum('underline', 'line-through', 'overline')),
      style: Type.String(),
      color: ColorSchema,
      thicknessPx: Type.Optional(PxSchema),
      offsetPx: Type.Optional(PxSchema),
      skipInk: Type.Optional(Type.Boolean()),
    }),
  ),
  color: ColorSchema,
  shadow: Type.Optional(Type.Array(CShadowSchema)),
});
export type CTextStyle = Static<typeof CTextStyleSchema>;

export const CFontUsageSchema = Type.Object({
  family: Type.String(),
  postScriptName: Type.String(),
  weights: Type.Array(Type.Number()),
  italic: Type.Boolean(),
  isCustom: Type.Boolean(),
  srcUrl: Type.Optional(Type.String()),
  status: Type.Optional(Enum('loaded', 'error', 'unloaded')),
  glyphCount: Type.Integer({ minimum: 0 }),
  iconFont: Type.Optional(Type.Boolean()),
  /** The font file, captured only for icon-font outlining (05 §icon-fonts). */
  asset: Type.Optional(AssetRefSchema),
});
export type CFontUsage = Static<typeof CFontUsageSchema>;

export const CReplacedSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('img'),
    asset: AssetRefSchema,
    natural: NaturalSizeSchema,
    objectFit: Type.String(),
    objectPosition: Type.String(),
    alt: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal('svg'),
    /** Serialized SVG text: styles inlined, `<use>` resolved. */
    asset: AssetRefSchema,
    hasFilter: Type.Boolean(),
    hasForeignObject: Type.Boolean(),
    hasMask: Type.Boolean(),
  }),
  /** Canvas, video frame, or an unsupported subtree screenshot. */
  Type.Object({ kind: Type.Literal('raster'), asset: AssetRefSchema, reason: Type.String() }),
  Type.Object({
    kind: Type.Literal('control'),
    control: NativeControlSchema,
    value: Type.Optional(Type.String()),
    placeholder: Type.Optional(Type.String()),
    checked: Type.Optional(Type.Boolean()),
    min: Type.Optional(Type.Number()),
    max: Type.Optional(Type.Number()),
    accentColor: Type.Optional(ColorSchema),
    nativeAppearance: Type.Boolean(),
  }),
]);
export type CReplaced = Static<typeof CReplacedSchema>;

/** Stacking facts for the mapper's paint sort (05 §paint). */
export const CPaintOrderSchema = Type.Object({
  stackingContext: Type.Boolean(),
  zIndex: Type.Union([Type.Integer(), Type.Literal('auto')]),
  layer: Enum('negative', 'block', 'float', 'inline', 'positioned', 'positive'),
  /** Order-modified document order index. */
  domIndex: Type.Integer({ minimum: 0 }),
});
export type CPaintOrder = Static<typeof CPaintOrderSchema>;

/** One node of the composed tree (06 §2.1). Recursive: `children` are `CNode`s. */
export const CNodeSchema = Type.Recursive(
  (This) =>
    Type.Object({
      /** Capture-local id (`data-fx-id`), stable across probes of the same variant. */
      id: Type.String({ minLength: 1 }),
      type: Enum('element', 'text', 'pseudo', 'replaced'),
      source: CSourceSchema,
      /** AABB of the border quad, page space. */
      borderBox: RectSchema,
      /** Only when transformed (CDP `DOM.getBoxModel`). */
      quads: Type.Optional(Type.Object({ border: QuadSchema, padding: QuadSchema, content: QuadSchema })),
      /** `offsetWidth`/`offsetHeight` equivalent. */
      untransformed: Type.Optional(Type.Object({ w: PxSchema, h: PxSchema })),
      /** Page-space affine derived from the quad; absent = identity. */
      transform: Type.Optional(Mat2x3Schema),
      /** Perspective or 3D: rasterize. */
      nonAffine: Type.Optional(Type.Boolean()),
      /** `getClientRects()` of an inline box with more than one fragment. */
      fragments: Type.Optional(Type.Array(RectSchema)),
      scroll: Type.Optional(Type.Object({ left: PxSchema, top: PxSchema, width: PxSchema, height: PxSchema })),
      computed: Type.Optional(CComputedSchema),
      authored: Type.Optional(CAuthoredSchema),
      text: Type.Optional(CTextSchema),
      replaced: Type.Optional(CReplacedSchema),
      /** Composed-tree order (slots flattened); not yet paint-sorted. */
      children: Type.Array(This),
      paint: CPaintOrderSchema,
    }),
  { $id: 'CNode' },
);
export type CNode = Static<typeof CNodeSchema>;

export const CAssetSchema = Type.Object({
  mime: Enum('image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'font/woff2', 'font/ttf', 'font/otf'),
  bytes: Type.Integer({ minimum: 0 }),
  natural: Type.Optional(NaturalSizeSchema),
  /** Stripped of query tokens (13 §redaction). */
  originalUrl: Type.Optional(Type.String()),
  /** e.g. `image/webp`: Figma accepts PNG, JPEG and GIF only. */
  transcodedFrom: Type.Optional(Type.String()),
});
export type CAsset = Static<typeof CAssetSchema>;

/** Custom properties visible on the capture root and its ancestors, per declaration site (08). */
export const CCustomPropertyTableSchema = Type.Object({
  declarations: Type.Array(
    Type.Object({
      name: Type.String({ pattern: '^--' }),
      value: Type.String(),
      resolved: Type.String(),
      selector: Type.String(),
      origin: Enum('root', 'theme', 'component', 'inline'),
      nodeId: Type.Optional(Type.String()),
    }),
  ),
});
export type CCustomPropertyTable = Static<typeof CCustomPropertyTableSchema>;

/** Layout probing at one width (05 §probing). */
export const CProbeSchema = Type.Object({
  widthPx: Type.Number({ minimum: 0 }),
  nodes: Type.Record(Type.String(), RectSchema),
  structureHash: Type.String(),
});
export type CProbe = Static<typeof CProbeSchema>;

/** A framework component instance found in the page (D-21). */
export const CComponentBoundarySchema = Type.Object({
  boundaryId: Type.String(),
  /** DOM root(s) rendered by this component instance. */
  nodeIds: Type.Array(Type.String()),
  framework: Enum('react', 'vue', 'angular', 'svelte', 'wc', 'unknown'),
  displayName: Type.String(),
  /** Resolved against Storybook `component` refs. */
  matchedSid: Type.Optional(Type.String()),
  props: Type.Optional(JsonRecordSchema),
  confidence: Enum('reference', 'name', 'structural'),
});
export type CComponentBoundary = Static<typeof CComponentBoundarySchema>;

const CNodeRef = RefTo(CNodeSchema);

/** Capture IR document: one per variant (06 §2). */
export const CaptureDocSchema = Type.Object(
  {
    kind: Type.Literal('holotype/capture'),
    captureVersion: SemverSchema,
    engine: Type.Object({
      name: Type.Literal('@holotype/capture'),
      version: Type.String(),
      chromium: Type.String(),
      playwright: Type.String(),
    }),
    target: Type.Object({
      /** Origin and path, credentials stripped. */
      storybookUrl: Type.String(),
      storyId: Type.String({ minLength: 1 }),
      sid: Type.String({ minLength: 1 }),
      vk: Hash16Schema,
      /** As applied; functions serialized as `"[fn name]"`. */
      args: JsonRecordSchema,
      globals: JsonRecordSchema,
      state: Type.Union([PseudoStateSpecSchema, Type.Null()]),
      viewport: Type.Object({ w: Type.Number({ minimum: 0 }), h: Type.Number({ minimum: 0 }) }),
      dpr: Type.Number({ exclusiveMinimum: 0 }),
      colorScheme: Enum('light', 'dark', 'no-preference'),
      /** Resolved capture root (05 §root). */
      rootSelector: Type.String(),
    }),
    timing: Type.Object({
      renderMs: Type.Number({ minimum: 0 }),
      settleMs: Type.Number({ minimum: 0 }),
      serializeMs: Type.Number({ minimum: 0 }),
    }),
    /** Union rect of the root and its portals, page space. */
    rootRect: RectSchema,
    root: CNodeSchema,
    /** Body-level overlays captured with the story (03 §portals). */
    portals: Type.Array(CNodeRef),
    /** Deduplicated; key = hash of the style. */
    textStyles: Type.Record(Type.String(), CTextStyleSchema),
    /** Key = sha256 of the bytes; bytes live out of line in the cache. */
    assets: KeyedRecord(Sha256Schema, CAssetSchema),
    fonts: Type.Array(CFontUsageSchema),
    customProperties: CCustomPropertyTableSchema,
    probes: Type.Optional(Type.Array(CProbeSchema)),
    framework: Type.Optional(
      Type.Object({ renderer: Type.String(), boundaries: Type.Array(CComponentBoundarySchema) }),
    ),
    /** `CSS.styleSheetAdded` headers, keyed by `styleSheetId` (branch mode, 05 §6.2). */
    styleSheets: Type.Optional(
      Type.Record(Type.String(), Type.Object({ sourceURL: Type.String(), sourceMapURL: Type.Optional(Type.String()) })),
    ),
    /** Playwright screenshot of the capture root (fidelity harness, 12). */
    screenshot: Type.Optional(AssetRefSchema),
    diagnostics: Type.Array(DiagnosticSchema),
  },
  { title: 'Holotype Capture IR (CaptureDoc)' },
);
export type CaptureDoc = Static<typeof CaptureDocSchema>;

/** Schemas a `CaptureDoc` refers to by `$id`. */
export const CAPTURE_REFERENCES = [CNodeSchema] as const;
