import { type Static, Type } from '@sinclair/typebox';
import { DiagnosticSchema, Hash16Schema, RectSchema, SemverSchema } from './common';

/**
 * Capture IR: raw browser facts for one variant (06 §2). v0 pins the envelope; the
 * composed node tree (`CNode`) lands with the capture engine in Phase 1.
 */
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
      storybookUrl: Type.String(),
      storyId: Type.String(),
      sid: Type.String(),
      vk: Hash16Schema,
      rootSelector: Type.String(),
    }),
    rootRect: RectSchema,
    diagnostics: Type.Array(DiagnosticSchema),
  },
  { title: 'Holotype Capture IR (CaptureDoc)' },
);

export type CaptureDoc = Static<typeof CaptureDocSchema>;
