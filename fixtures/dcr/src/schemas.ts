import {
  BaselineSnapshotSchema,
  CommitSchema,
  DcrHashSchema,
  DcrScopeSchema,
  DcrTargetsSchema,
  FigmaNodeIdSchema,
  UsageNodeRef,
  UsageNodeSchema,
} from '@holotype/dcr';
import {
  CodeRefSchema,
  createValidator,
  Enum,
  Hash16Schema,
  ProvenanceDocSchema,
  ResolvedDcrConfigSchema,
  SourceLocSchema,
  type Validator,
} from '@holotype/ir';
import { type Static, Type } from '@sinclair/typebox';

/*
 * Schemas of the case files that `@holotype/dcr` does not own. The snapshot, baseline and
 * request schemas come from `@holotype/dcr` (B-64); these describe what the fixtures add
 * around them: the case config, `branch:meta` inside the snapshot, the root registry, the
 * CLI provenance side data and the snippet goldens.
 */

/** `config.json`: the resolved `dcr` config (16 §15), equal to `branch:meta.dcrConfig`. */
export const CaseConfigSchema = ResolvedDcrConfigSchema;
export type CaseConfig = Static<typeof CaseConfigSchema>;

/** `branch:meta` (15 §2.2): root shared plugin data of a branch file, as canonical JSON. */
export const BranchMetaSchema = Type.Object({
  v: Type.Literal(2),
  repo: Type.String({ minLength: 1 }),
  branch: Type.String({ minLength: 1 }),
  baseCommit: CommitSchema,
  baselineFp: Hash16Schema,
  baselineRunId: Type.Optional(Type.String()),
  kind: Enum('duplicate', 'figma-branch'),
  fileKey: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  fileId: Type.String({ minLength: 1 }),
  mode: Type.Literal('proposal'),
  status: Enum('editing', 'submitted', 'changes-requested', 'approved', 'verifying', 'merged', 'archived'),
  baseFrames: Type.Array(FigmaNodeIdSchema),
  dcrConfig: ResolvedDcrConfigSchema,
  configHash: Hash16Schema,
  lastDcr: Type.Optional(
    Type.Object({
      id: DcrHashSchema,
      hash: DcrHashSchema,
      versionId: Type.Optional(Type.String()),
      scope: DcrScopeSchema,
      excluded: Type.Array(Type.String()),
      chunks: Type.Integer({ minimum: 0 }),
      parent: Type.Optional(DcrHashSchema),
    }),
  ),
});
export type BranchMeta = Static<typeof BranchMetaSchema>;

/**
 * The root registry (10 §2.3) after joining its chunks. The fixtures keep it in one chunk
 * (`registry:0`). `storybook.framework` is not in 10 §2.3; the DCR header needs it (15 §6).
 */
export const RegistrySchema = Type.Object({
  v: Type.Literal(1),
  rev: Type.Integer({ minimum: 0 }),
  storybook: Type.Object({
    url: Type.Optional(Type.String()),
    fingerprint: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1 }),
    framework: Type.String({ minLength: 1 }),
  }),
  pages: Type.Object({ components: FigmaNodeIdSchema, icons: Type.Optional(FigmaNodeIdSchema) }),
  components: Type.Record(
    Type.String({ minLength: 1 }),
    Type.Object({
      setId: FigmaNodeIdSchema,
      pageId: FigmaNodeIdSchema,
      name: Type.String(),
      irh: Hash16Schema,
      fp: Hash16Schema,
      status: Type.String(),
      variants: Type.Integer({ minimum: 1 }),
    }),
  ),
  icons: Type.Record(Type.String(), Type.Object({ componentId: FigmaNodeIdSchema, svgh: Type.String() })),
  images: Type.Record(Type.String(), Type.String()),
  tokens: Type.Record(
    Type.String({ pattern: '^--' }),
    Type.Object({ variableId: Type.String(), collectionId: Type.String() }),
  ),
});
export type Registry = Static<typeof RegistrySchema>;

/**
 * `provenance.json`: what the CLI knows from the capture cache when it attaches provenance
 * (15 §5): the `CodeRef` and provenance side file (`provenance/<sid>.json`, 06 §4.1) of each
 * component, and where each token is defined (`varDefinition`, 15 §5.4).
 */
export const FixtureProvenanceSchema = Type.Object({
  kind: Type.Literal('holotype/fixture-provenance'),
  v: Type.Literal(1),
  components: Type.Array(Type.Object({ code: CodeRefSchema, doc: ProvenanceDocSchema })),
  tokens: Type.Record(Type.String({ pattern: '^--' }), SourceLocSchema),
});
export type FixtureProvenance = Static<typeof FixtureProvenanceSchema>;

/** `snippet/<row>.json`: one row of the snippet table (15 §7.3) as a `renderSnippet` input. */
export const SnippetCaseSchema = Type.Object({
  kind: Type.Literal('holotype/fixture-snippet'),
  v: Type.Literal(1),
  /** The row of 15 §7.3 this case covers. */
  row: Enum('VARIANT', 'BOOLEAN', 'TEXT'),
  targets: DcrTargetsSchema,
  tree: Type.Array(UsageNodeRef, { minItems: 1 }),
});
export type SnippetCase = Static<typeof SnippetCaseSchema>;

export const validateCaseConfig: Validator<CaseConfig> = createValidator(CaseConfigSchema);
export const validateBranchMeta: Validator<BranchMeta> = createValidator(BranchMetaSchema);
export const validateRegistry: Validator<Registry> = createValidator(RegistrySchema);
/** `baseline.json`: every embedded baseline in scope, one per variant plus one per set (15 §3.3). */
export const BaselineFileSchema = Type.Array(BaselineSnapshotSchema, { minItems: 1 });
export const validateBaselineFile: Validator<Static<typeof BaselineFileSchema>> = createValidator(BaselineFileSchema);
export const validateFixtureProvenance: Validator<FixtureProvenance> = createValidator(FixtureProvenanceSchema);
export const validateSnippetCase: Validator<SnippetCase> = createValidator(SnippetCaseSchema, {
  references: [UsageNodeSchema],
});
