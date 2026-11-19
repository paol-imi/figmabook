import { type Static, Type } from '@sinclair/typebox';
import { DiagnosticSchema } from './common';

const Count = Type.Integer({ minimum: 0 });
const Ratio = Type.Number({ minimum: 0, maximum: 1 });

/** `report.json`: the same schema for CLI, Action and plugin export (06 §4.4, 12 §7.1). */
export const BundleReportSchema = Type.Object(
  {
    kind: Type.Literal('holotype/report'),
    summary: Type.Object({
      components: Count,
      variants: Count,
      warnings: Count,
      errors: Count,
      autoLayoutCoverage: Ratio,
      propertyQuality: Ratio,
      rasterizedNodes: Count,
    }),
    byCode: Type.Record(Type.String(), Count),
    components: Type.Array(
      Type.Object({
        sid: Type.String(),
        diagnostics: Type.Array(DiagnosticSchema),
        skipped: Type.Optional(Type.Object({ reason: Type.String() })),
      }),
    ),
  },
  { title: 'Holotype run report (BundleReport)' },
);

export type BundleReport = Static<typeof BundleReportSchema>;
