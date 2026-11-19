import { DiagnosticSchema, Enum, SemverSchema, TimestampSchema } from '@holotype/ir';
import { type Static, Type } from '@sinclair/typebox';
import { DCR_ITEM_KINDS, type DcrItemKind, DcrItemSchema } from './item';
import { CommitSchema, DcrCodeSchema, DcrHashSchema, SidSchema, UntrustedTextSchema } from './primitives';
import { DcrScopeSchema } from './scope';
import { UsageNodeSchema } from './usage';

/*
 * The Design Change Request document, `dcr.json` (15 §6). The hash covers the *core* only
 * (15 §4.9, D-50): see `dcrCore` for what is left out.
 */

/** A repository a request's items are implemented in (15 §5.5). */
export const RepoRefSchema = Type.Object({
  /** Normalized remote, e.g. `github.com/acme/shop`. */
  repo: Type.String({ minLength: 1 }),
  /** Sub-directory in a monorepo, e.g. `apps/web`. */
  path: Type.Optional(Type.String()),
  /** Components only: the published package, e.g. `@acme/ui`. */
  package: Type.Optional(Type.String()),
  /** Screens only; default `header.branch`. */
  branch: Type.Optional(Type.String()),
});
export type RepoRef = Static<typeof RepoRefSchema>;

export const DcrTargetsSchema = Type.Object({
  /** Where component, variant, property, node and token items go (= `header.repo`). */
  components: RepoRefSchema,
  /** Where screen items go; absent = the components repo. */
  screens: Type.Optional(RepoRefSchema),
});
export type DcrTargets = Static<typeof DcrTargetsSchema>;

export const DcrHeaderSchema = Type.Object({
  repo: Type.String({ minLength: 1 }),
  branch: Type.String({ minLength: 1 }),
  baseCommit: CommitSchema,
  dirty: Type.Boolean(),
  targets: DcrTargetsSchema,
  figma: Type.Object({
    fileKey: Type.String({ minLength: 1 }),
    /** The named version saved at Submit (D-48). Outside the core. */
    fileVersion: Type.Optional(Type.String({ minLength: 1 })),
    kind: Enum('duplicate', 'figma-branch'),
    /** `h16` of the canonical `FigmaSnapshot` the request was extracted from. */
    snapshotHash: DcrHashSchema,
  }),
  baseline: Type.Object({
    /** Bundle fingerprint applied as the baseline. */
    fp: DcrHashSchema,
    runId: Type.Optional(Type.String({ minLength: 1 })),
    storybookVersion: Type.String({ minLength: 1 }),
    framework: Type.String({ minLength: 1 }),
  }),
  scope: DcrScopeSchema,
  extractor: Type.Object({
    version: SemverSchema,
    /** `h16(canonical(branch:meta.dcrConfig))` (D-50). */
    configHash: DcrHashSchema,
  }),
  /** Id of the previous request on this branch (D-56). */
  parent: Type.Optional(DcrHashSchema),
  /** Shared by the requests of one split (15 §7.1). */
  group: Type.Optional(Type.String({ minLength: 1 })),
  /** CLI-added at import or pull (15 §5.6). Outside the core. */
  headCommit: Type.Optional(CommitSchema),
  /** Outside the core; omitted in tests. */
  generated: Type.Optional(Type.Object({ at: TimestampSchema, by: Enum('cli', 'plugin', 'mcp') })),
});
export type DcrHeader = Static<typeof DcrHeaderSchema>;

/** A deterministic open question (15 §6). Answers live outside the DCR (D-56, `DcrAnswers`). */
export const DcrQuestionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  itemId: DcrHashSchema,
  code: DcrCodeSchema,
  /** Template-built. */
  text: Type.String({ minLength: 1 }),
  options: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});
export type DcrQuestion = Static<typeof DcrQuestionSchema>;

const PositiveCount = Type.Integer({ minimum: 1 });
const Count = Type.Integer({ minimum: 0 });

/** The review page (15 §7.4). */
export const DcrSummarySchema = Type.Object({
  /** Items per kind; kinds with 0 are omitted. */
  counts: Type.Partial(
    Type.Object(
      Object.fromEntries(DCR_ITEM_KINDS.map((kind) => [kind, PositiveCount])) as Record<
        DcrItemKind,
        typeof PositiveCount
      >,
    ),
  ),
  /** Sids touched by modified, variant, property and node items. Sorted. */
  components: Type.Array(SidSchema),
  newComponents: Type.Array(
    Type.Object({ itemId: DcrHashSchema, name: UntrustedTextSchema, nearest: Type.Optional(SidSchema) }),
  ),
  screens: Type.Array(
    Type.Object({
      itemId: DcrHashSchema,
      name: UntrustedTextSchema,
      breakpoints: Type.Array(Type.String()),
      states: Type.Array(Type.String()),
      interactions: Count,
    }),
  ),
  tokens: Type.Object({ changed: Count, added: Count, untokenized: Count }),
  /** Screens still holding placeholder text. */
  content: Type.Object({ placeholders: Count }),
  questions: Count,
  /** Template-built lines, e.g. `Button: padding 12 → 16 (Space/3 → Space/4)`. */
  headline: Type.Array(Type.String(), { maxItems: 8 }),
});
export type DcrSummary = Static<typeof DcrSummarySchema>;

/** `DesignChangeRequest` (15 §6): `dcr.json`. */
export const DesignChangeRequestSchema = Type.Object(
  {
    kind: Type.Literal('holotype/dcr'),
    dcrVersion: SemverSchema,
    /** `h16(repo ∥ branch ∥ fileKey ∥ dcrHash)` (`dcrId`). */
    id: DcrHashSchema,
    /** `h16(canonical(core))` (`dcrHash`). */
    dcrHash: DcrHashSchema,
    header: DcrHeaderSchema,
    /** Sorted (15 §4.9, `sortDcr`). */
    items: Type.Array(DcrItemSchema),
    questions: Type.Array(DcrQuestionSchema),
    summary: DcrSummarySchema,
    diagnostics: Type.Array(DiagnosticSchema),
  },
  {
    title: 'Holotype Design Change Request (DesignChangeRequest)',
    $defs: { UsageNode: UsageNodeSchema },
  },
);
export type DesignChangeRequest = Static<typeof DesignChangeRequestSchema>;

/** Schemas a `DesignChangeRequest` refers to by `$id`. */
export const DCR_REFERENCES = [UsageNodeSchema] as const;
