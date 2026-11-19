import { type Static, Type } from '@sinclair/typebox';
import { DiagnosticSchema, Hash16Schema, SemverSchema } from './common';

export const SceneVariantSchema = Type.Object({
  vk: Hash16Schema,
  irh: Hash16Schema,
  /** Variant property values, e.g. `{ "Size": "md" }`. */
  values: Type.Record(Type.String(), Type.String()),
});

/**
 * Scene IR: the Figma-ready desired state of one component set (06 §3). v0 pins the
 * envelope; `SceneNode` trees, properties and set layout are added in Phase 1.
 */
export const SceneComponentSchema = Type.Object(
  {
    kind: Type.Literal('holotype/scene-component'),
    sceneVersion: SemverSchema,
    sid: Type.String({ minLength: 1 }),
    irh: Hash16Schema,
    variants: Type.Array(SceneVariantSchema, { minItems: 1 }),
    dependencies: Type.Array(Type.String()),
    diagnostics: Type.Array(DiagnosticSchema),
  },
  { title: 'Holotype Scene IR (SceneComponent)' },
);

export type SceneVariant = Static<typeof SceneVariantSchema>;
export type SceneComponent = Static<typeof SceneComponentSchema>;
