import { type Static, Type } from '@sinclair/typebox';
import { CountSchema, DiagnosticSchema, Enum, Hash16Schema, RatioSchema } from './primitives';

/** `report.json` of a bundle (06 §4.4). The CLI's `RunReport` (12 §7.1) embeds it as `bundle`. */
export const BundleReportSchema = Type.Object(
  {
    kind: Type.Literal('holotype/report'),
    summary: Type.Object({
      components: CountSchema,
      variants: CountSchema,
      warnings: CountSchema,
      errors: CountSchema,
      autoLayoutCoverage: RatioSchema,
      propertyQuality: RatioSchema,
      rasterizedNodes: CountSchema,
    }),
    /** Diagnostic counts by code. */
    byCode: Type.Record(Type.String(), CountSchema),
    components: Type.Array(
      Type.Object({
        sid: Type.String({ minLength: 1 }),
        diagnostics: Type.Array(DiagnosticSchema),
        skipped: Type.Optional(Type.Object({ reason: Type.String() })),
        planner: Type.Optional(
          Type.Object({
            budget: Type.Object({ requested: CountSchema, emitted: CountSchema, strategy: Type.String() }),
            droppedAxes: Type.Array(Type.String()),
          }),
        ),
      }),
    ),
  },
  { title: 'Holotype bundle report (BundleReport)' },
);
export type BundleReport = Static<typeof BundleReportSchema>;

/**
 * Written by the plugin after each apply (06 §4.5); `holotype-map.json` is derived from it.
 * It lives in memory and in plugin exports, so `baselines[].snapshotGz` is raw bytes.
 */
export const ApplyReportSchema = Type.Object(
  {
    kind: Type.Literal('holotype/apply-report'),
    applyId: Type.String({ minLength: 1 }),
    /** `figma.fileKey` when available (D-53). */
    fileKey: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    /** Random id from root plugin data (D-53). */
    fileId: Type.Optional(Type.String({ minLength: 1 })),
    components: Type.Array(
      Type.Object({
        sid: Type.String({ minLength: 1 }),
        setId: Type.String({ minLength: 1 }),
        componentKey: Type.Optional(Type.String()),
        status: Enum('synced', 'partial', 'failed', 'skipped'),
        variants: Type.Array(
          Type.Object({
            vk: Hash16Schema,
            nodeId: Type.String({ minLength: 1 }),
            readback: Type.Object({ maxDelta: Type.Number({ minimum: 0 }) }),
          }),
        ),
      }),
    ),
    /** Over-budget baselines (`DCR_BASELINE_EXTERNAL`). */
    baselines: Type.Optional(Type.Array(Type.Object({ vk: Hash16Schema, snapshotGz: Type.Uint8Array() }))),
    diagnostics: Type.Array(DiagnosticSchema),
  },
  { title: 'Holotype apply report (ApplyReport)' },
);
export type ApplyReport = Static<typeof ApplyReportSchema>;
