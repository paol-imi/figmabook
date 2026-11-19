import { type Static, Type } from '@sinclair/typebox';

export const SemverSchema = Type.String({
  pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$',
  description: 'Semantic version',
});

/** 16 lowercase hex characters: `vk`, `irh` and other truncated sha256 hashes (06 §6). */
export const Hash16Schema = Type.String({ pattern: '^[0-9a-f]{16}$' });

/** 64 lowercase hex characters: full sha256 of asset bytes. */
export const Sha256Schema = Type.String({ pattern: '^[0-9a-f]{64}$' });

/** Lengths are CSS px at DPR 1, which equals a Figma px (06 intro, §5). */
export const PxSchema = Type.Number();
export type Px = Static<typeof PxSchema>;

export const RectSchema = Type.Object({ x: PxSchema, y: PxSchema, w: PxSchema, h: PxSchema });
export type Rect = Static<typeof RectSchema>;

export const DiagnosticSchema = Type.Object({
  code: Type.String({ pattern: '^[A-Z]+(?:_[A-Z0-9]+)+$' }),
  severity: Type.Union([Type.Literal('info'), Type.Literal('warn'), Type.Literal('error'), Type.Literal('fatal')]),
  message: Type.String(),
  nodeKey: Type.Optional(Type.String()),
  variantKey: Type.Optional(Type.String()),
  sid: Type.Optional(Type.String()),
  property: Type.Optional(Type.String()),
  value: Type.Optional(Type.String({ maxLength: 200 })),
  fallback: Type.Optional(Type.String()),
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
