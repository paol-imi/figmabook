import { type Static, Type } from '@sinclair/typebox';
import { ResolvedDcrConfigSchema } from './config';
import {
  CountSchema,
  Enum,
  Hash16Schema,
  KeyedRecord,
  RelativePathSchema,
  SemverSchema,
  Sha256Schema,
  TimestampSchema,
} from './primitives';

/** Semantics a consumer must understand to apply a bundle correctly (06 §4.2, §7). */
export const BUNDLE_FEATURES = [
  'grid-layout',
  'variable-fonts',
  'locked-lines',
  'slots',
  'instance-swap',
  'tokens',
  'tokens-modes',
  'tokens-motion',
  'text-styles',
  'effect-styles',
  'source-color',
  'decomposed-borders',
  'rasterized-subtrees',
  'prototype-reactions',
  'library-refs',
] as const;

export const BundleFeatureSchema = Enum(...BUNDLE_FEATURES);
export type BundleFeature = Static<typeof BundleFeatureSchema>;

/**
 * Branch block (06 §4.2 "branch-block"): written by `holotype branch start|refresh`; the
 * plugin copies it, plus `fileKey` and its own fields, to `branch:meta` (15 §2.2, D-50).
 */
export const BranchBlockSchema = Type.Object({
  /** Normalized remote without credentials, e.g. `github.com/acme/ui`. */
  repo: Type.String({ minLength: 1 }),
  branch: Type.String({ minLength: 1 }),
  /** Equals `source.git.sha`; becomes the DCR `baseCommit`. */
  baseCommit: Type.String({ pattern: '^[0-9a-f]{7,64}$' }),
  dirty: Type.Boolean(),
  /** The resolved `dcr` config (16 §15). */
  dcrConfig: ResolvedDcrConfigSchema,
  /** `h16(canonicalJSON(dcrConfig))`. */
  configHash: Hash16Schema,
});
export type BranchBlock = Static<typeof BranchBlockSchema>;

export const BundleComponentEntrySchema = Type.Object({
  sid: Type.String({ minLength: 1 }),
  name: Type.String(),
  titlePath: Type.Array(Type.String()),
  /** The component `irh`; there is no separate scene hash. */
  irh: Hash16Schema,
  /** `components/<sid>.json`; its sha256 is in `integrity.files`. */
  file: RelativePathSchema,
  bytes: CountSchema,
  variants: CountSchema,
  nodes: CountSchema,
  dependencies: Type.Array(Type.String()),
  status: Enum('ok', 'partial', 'failed'),
  plan: Type.Optional(Type.Object({ planHash: Hash16Schema })),
});
export type BundleComponentEntry = Static<typeof BundleComponentEntrySchema>;

/** `manifest.json` of a bundle (06 §4.2): the only manifest shape. */
export const BundleManifestSchema = Type.Object(
  {
    kind: Type.Literal('holotype/bundle'),
    /** Semver of the bundle format. */
    bundleVersion: SemverSchema,
    /** Excluded from every hash. */
    runId: Type.String({ minLength: 1 }),
    /** Excluded from every hash. */
    createdAt: TimestampSchema,
    sceneVersion: SemverSchema,
    tokensVersion: Type.Optional(SemverSchema),
    features: Type.Array(BundleFeatureSchema),
    generator: Type.Object({
      name: Type.Literal('@holotype/cli'),
      version: Type.String(),
      mapper: Type.String(),
      capture: Type.String(),
      chromium: Type.String(),
      playwright: Type.String(),
    }),
    createdBy: Enum('cli', 'action', 'server', 'hosted'),
    source: Type.Object({
      storybookVersion: Type.String(),
      renderer: Type.Optional(Type.String()),
      builder: Type.Optional(Type.String()),
      /** Redacted URL: no credentials, no query. */
      origin: Type.String(),
      /** Storybook build fingerprint (02 §cache); not the bundle fingerprint `bundleFp`. */
      fingerprint: Sha256Schema,
      /** Required in branch mode; `ref` is `HEAD` when detached. */
      git: Type.Optional(
        Type.Object({ sha: Type.String({ pattern: '^[0-9a-f]{7,64}$' }), ref: Type.String(), dirty: Type.Boolean() }),
      ),
    }),
    /** Hash of the effective config, not the config itself. */
    config: Type.Object({ hash: Type.String({ minLength: 1 }) }),
    components: Type.Array(BundleComponentEntrySchema),
    /** Sorted by `sha`. */
    assets: Type.Array(
      Type.Object({
        sha: Sha256Schema,
        mime: Type.String(),
        bytes: CountSchema,
        natural: Type.Optional(Type.Object({ w: CountSchema, h: CountSchema })),
      }),
    ),
    /** Font preflight input (09 §fonts). */
    fonts: Type.Array(
      Type.Object({
        family: Type.String({ minLength: 1 }),
        styles: Type.Array(Type.String()),
        isCustom: Type.Boolean(),
        srcUrl: Type.Optional(Type.String()),
      }),
    ),
    tokens: Type.Optional(
      Type.Object({
        file: Type.Literal('tokens.json'),
        irh: Hash16Schema,
        variables: CountSchema,
        collections: CountSchema,
      }),
    ),
    totals: Type.Object({
      components: CountSchema,
      variants: CountSchema,
      nodes: CountSchema,
      assetBytes: CountSchema,
    }),
    /** sha256 of every file except `manifest.json`, keyed by bundle path (02 §5.1). */
    integrity: Type.Object({
      algo: Type.Literal('sha256'),
      files: KeyedRecord(RelativePathSchema, Sha256Schema),
    }),
    /** sid → old `nk` → new `nk` (renamed nodes keep their Figma layer). */
    nkMigrations: Type.Optional(Type.Record(Type.String(), Type.Record(Type.String(), Type.String()))),
    /** sid → published component key (feature `library-refs`). */
    libraryComponents: Type.Optional(Type.Record(Type.String(), Type.String({ minLength: 1 }))),
    /** Required when importing as a branch file (D-50). */
    branch: Type.Optional(BranchBlockSchema),
  },
  { title: 'Holotype bundle manifest (BundleManifest)' },
);
export type BundleManifest = Static<typeof BundleManifestSchema>;
