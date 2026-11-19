import { type Static, Type } from '@sinclair/typebox';
import { Hash16Schema, SemverSchema, Sha256Schema } from './common';

export const BundleFeatureSchema = Type.Union(
  [
    'grid-layout',
    'variable-fonts',
    'locked-lines',
    'slots',
    'instance-swap',
    'tokens',
    'tokens-modes',
    'text-styles',
    'effect-styles',
    'source-color',
    'decomposed-borders',
    'rasterized-subtrees',
    'prototype-reactions',
  ].map((feature) => Type.Literal(feature)),
);

const Count = Type.Integer({ minimum: 0 });

/** `manifest.json` of a bundle (06 §4.2). */
export const BundleManifestSchema = Type.Object(
  {
    kind: Type.Literal('holotype/bundle'),
    bundleVersion: SemverSchema,
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
    createdBy: Type.Union([
      Type.Literal('cli'),
      Type.Literal('action'),
      Type.Literal('server'),
      Type.Literal('hosted'),
    ]),
    source: Type.Object({
      storybookVersion: Type.String(),
      renderer: Type.Optional(Type.String()),
      builder: Type.Optional(Type.String()),
      origin: Type.String(),
      fingerprint: Sha256Schema,
      git: Type.Optional(Type.Object({ sha: Type.String(), ref: Type.String(), dirty: Type.Boolean() })),
    }),
    config: Type.Object({ hash: Type.String() }),
    components: Type.Array(
      Type.Object({
        sid: Type.String({ minLength: 1 }),
        name: Type.String(),
        titlePath: Type.Array(Type.String()),
        irh: Hash16Schema,
        file: Type.String(),
        bytes: Count,
        variants: Count,
        nodes: Count,
        dependencies: Type.Array(Type.String()),
      }),
    ),
    assets: Type.Array(
      Type.Object({
        sha: Sha256Schema,
        mime: Type.String(),
        bytes: Count,
        natural: Type.Optional(Type.Object({ w: Count, h: Count })),
      }),
    ),
    fonts: Type.Array(
      Type.Object({
        family: Type.String(),
        styles: Type.Array(Type.String()),
        isCustom: Type.Boolean(),
        srcUrl: Type.Optional(Type.String()),
      }),
    ),
    tokens: Type.Optional(
      Type.Object({ file: Type.Literal('tokens.json'), irh: Hash16Schema, variables: Count, collections: Count }),
    ),
    totals: Type.Object({ components: Count, variants: Count, nodes: Count, assetBytes: Count }),
  },
  { title: 'Holotype bundle manifest (BundleManifest)' },
);

export type BundleFeature = Static<typeof BundleFeatureSchema>;
export type BundleManifest = Static<typeof BundleManifestSchema>;
