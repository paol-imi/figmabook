import {
  type Static,
  type TLiteral,
  type TSchema,
  type TString,
  type TUnion,
  type TUnsafe,
  Type,
} from '@sinclair/typebox';

/*
 * Shared primitives (06 §1). IR documents are *open*: consumers ignore unknown fields
 * within a known major (06 §7), so their objects do not set `additionalProperties`.
 * Config and `parameters.holotype` are *strict* (04 §9, 16 §2); see `config.ts`.
 */

/** A union of string literals, e.g. `Enum('MIN', 'MAX')`. */
export function Enum<const T extends readonly string[]>(...values: T): TUnion<TLiteral<T[number]>[]> {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

/**
 * A `$ref` to a schema with an `$id` (a recursive node type), typed as that schema. The
 * referenced schema must be embedded in the same document and passed to the validator.
 */
export function RefTo<T extends TSchema>(schema: T): TUnsafe<Static<T>> {
  if (schema.$id === undefined) throw new TypeError('RefTo: the referenced schema needs an $id.');
  return Type.Unsafe<Static<T>>(Type.Ref(schema.$id));
}

/**
 * A record whose keys must match `key` (a string schema with a `pattern`). A key that does
 * not match is an error, even in an open document: it is a bad value, not a future field.
 */
export function KeyedRecord<K extends TString, V extends TSchema>(key: K, value: V) {
  if (key.pattern === undefined) throw new TypeError('KeyedRecord: the key schema needs a pattern.');
  return Type.Record(key, value, { additionalProperties: false });
}

export const SemverSchema = Type.String({
  pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$',
  description: 'Semantic version',
});

/** 16 lowercase hex characters: `vk`, `irh` and other truncated sha256 hashes (06 §6). */
export const Hash16Schema = Type.String({ pattern: '^[0-9a-f]{16}$' });

/** 64 lowercase hex characters: full sha256 of asset or file bytes. */
export const Sha256Schema = Type.String({ pattern: '^[0-9a-f]{64}$' });

/** An ISO 8601 timestamp with a zone, e.g. `2026-11-19T10:00:00Z`. Never part of a hash. */
export const TimestampSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$',
});

/**
 * A repo- or bundle-relative path with `/` separators: not absolute, no drive letter, no
 * backslash and no `..` segment (13 §redaction; 15 §5.2 "validated inside repo").
 */
export const RelativePathSchema = Type.String({
  minLength: 1,
  pattern: '^(?![A-Za-z]:)(?!/)(?!(?:.*/)?\\.\\.(?:/|$))[^\\\\\\u0000]+$',
});

/** Lengths are CSS px at DPR 1, which equals a Figma px; canonicalized to 1/1000 (06 §5). */
export const PxSchema = Type.Number();
export type Px = Static<typeof PxSchema>;

/** A 0..1 ratio: color channels, opacity, gradient stop positions (canonicalized to 1e-6). */
export const RatioSchema = Type.Number({ minimum: 0, maximum: 1 });

export const CountSchema = Type.Integer({ minimum: 0 });

export const RectSchema = Type.Object({ x: PxSchema, y: PxSchema, w: PxSchema, h: PxSchema });
export type Rect = Static<typeof RectSchema>;

export const SizeSchema = Type.Object({ w: PxSchema, h: PxSchema });
export type Size = Static<typeof SizeSchema>;

export const PointSchema = Type.Object({ x: PxSchema, y: PxSchema });
export type Point = Static<typeof PointSchema>;

/** A viewport in CSS px (`vk` input, 06 §6). */
export const ViewportSchema = Type.Object({ w: Type.Number({ minimum: 0 }), h: Type.Number({ minimum: 0 }) });
export type Viewport = Static<typeof ViewportSchema>;

/** Border-quad corners TL, TR, BR, BL as `x, y` pairs in page space. */
export const QuadSchema = Type.Tuple([PxSchema, PxSchema, PxSchema, PxSchema, PxSchema, PxSchema, PxSchema, PxSchema]);
export type Quad = Static<typeof QuadSchema>;

/** A 2×3 affine matrix `[[a, c, tx], [b, d, ty]]`, Figma's `Transform` (canonicalized to 1e-6). */
export const Mat2x3Schema = Type.Tuple([
  Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
  Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
]);
export type Mat2x3 = Static<typeof Mat2x3Schema>;

/** Four values in CSS order: top, right, bottom, left. */
export const Sides = <T extends TSchema>(item: T) => Type.Tuple([item, item, item, item]);
/** Four corner values in CSS order: top-left, top-right, bottom-right, bottom-left. */
export const Corners = Sides;

export const ColorSpaceSchema = Enum('srgb', 'display-p3');
export type ColorSpace = Static<typeof ColorSpaceSchema>;

/** A gamma-encoded 0..1 color in its declared space (06 intro). */
export const ColorSchema = Type.Object({
  r: RatioSchema,
  g: RatioSchema,
  b: RatioSchema,
  a: RatioSchema,
  space: ColorSpaceSchema,
  /** The CSS text when it was not plain sRGB, e.g. `oklch(0.7 0.1 250)`. */
  original: Type.Optional(Type.String()),
});
export type Color = Static<typeof ColorSchema>;

/** Figma RGB (`SolidPaint.color`). */
export const RgbSchema = Type.Object({ r: RatioSchema, g: RatioSchema, b: RatioSchema });
export type Rgb = Static<typeof RgbSchema>;

/** Figma RGBA (gradient stops, effects). */
export const RgbaSchema = Type.Object({ r: RatioSchema, g: RatioSchema, b: RatioSchema, a: RatioSchema });
export type Rgba = Static<typeof RgbaSchema>;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * Any JSON value. Documents are parsed from JSON, so the schema accepts anything; the
 * static type is the precise recursive `JsonValue`.
 */
export const JsonValueSchema = Type.Unsafe<JsonValue>(Type.Unknown({ description: 'Any JSON value' }));

export const JsonRecordSchema = Type.Record(Type.String(), JsonValueSchema);

/** Same severities as `@holotype/shared`; `fatal` only ever appears in run reports. */
export const SeveritySchema = Enum('info', 'warn', 'error', 'fatal');

/** An emitted diagnostic (06 §1, 02 §9). Codes are catalogued in 12 §6.2. */
export const DiagnosticSchema = Type.Object({
  code: Type.String({ pattern: '^[A-Z]+(?:_[A-Z0-9]+)+$' }),
  severity: SeveritySchema,
  message: Type.String(),
  /** `nk` (Scene IR) or the capture node id (Capture IR). */
  nodeKey: Type.Optional(Type.String()),
  variantKey: Type.Optional(Type.String()),
  sid: Type.Optional(Type.String()),
  property: Type.Optional(Type.String()),
  value: Type.Optional(Type.String({ maxLength: 200 })),
  fallback: Type.Optional(Type.String()),
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type IrDiagnostic = Static<typeof DiagnosticSchema>;

/** A content-addressed asset (06 §1): bytes live at `assets/<sha>`. */
export const AssetRefSchema = Type.Object({ sha: Sha256Schema });
export type AssetRef = Static<typeof AssetRefSchema>;

/**
 * A location in a repository file (15 §5.2). `line` and `col` are 1-based, as editors
 * and `data-holotype-loc` show them.
 */
export const SourceLocSchema = Type.Object({
  file: RelativePathSchema,
  line: Type.Integer({ minimum: 1 }),
  col: Type.Integer({ minimum: 1 }),
});
export type SourceLoc = Static<typeof SourceLocSchema>;

/** The pseudo-classes a variant can be rendered in (04 §1, 06 §2). */
export const PseudoClassSchema = Enum('hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited', 'target');
export type PseudoClass = Static<typeof PseudoClassSchema>;

/** How a pseudo-state is applied; the same strings as `states.mode` (04 §6.4). */
export const PseudoStateSpecSchema = Type.Object({
  classes: Type.Array(PseudoClassSchema),
  method: Enum('force', 'interact', 'addon'),
  /** The element that receives the state; default is the component root. */
  selector: Type.Optional(Type.String()),
});
export type PseudoStateSpec = Static<typeof PseudoStateSpecSchema>;
