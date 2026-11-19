import { type Static, Type } from '@sinclair/typebox';
import { Enum, SourceLocSchema } from './primitives';

/*
 * Provenance (15 §5.2–5.3): from a Scene field back to the CSS and the code that produced
 * it. `provenance/<sid>.json` is a CLI-side side file: never hashed, never sent to the plugin.
 * The DCR schemas (15 §6, package `dcr`) build on `FieldOrigin`, `SourceLoc` and `CodeRef`.
 */

/** How the mapper derived a Scene field from CSS (07); the DCR extractor reverses it. */
export const FieldTransformSchema = Enum('border-included', 'margin-to-gap', 'percent-resolved', 'none');
export type FieldTransform = Static<typeof FieldTransformSchema>;

/** The CSS origin of one Scene field (15 §5.2). */
export const FieldOriginSchema = Type.Object({
  /** e.g. `["padding-left"]`, or `["border-left-width", "padding-left"]` (D-16). */
  css: Type.Array(Type.String(), { minItems: 1 }),
  /** e.g. `var(--space-3)`. */
  authored: Type.Optional(Type.String()),
  /** Original (de-hashed) selector, e.g. `.btn`. */
  selector: Type.Optional(Type.String()),
  /** The winning rule, source-mapped to the repo (e.g. `Button.module.css:14:3`). */
  rule: Type.Optional(SourceLocSchema),
  /** e.g. `["--btn-pad-x", "--space-3"]`. */
  varChain: Type.Optional(Type.Array(Type.String({ pattern: '^--' }))),
  transform: Type.Optional(FieldTransformSchema),
});
export type FieldOrigin = Static<typeof FieldOriginSchema>;

/** Provenance of one node `(vk, nk)`. */
export const NodeProvenanceSchema = Type.Object({
  dom: Type.Object({
    path: Type.String(),
    tag: Type.String(),
    classes: Type.Optional(Type.Array(Type.String())),
    /** JSX location (`CSource.loc`). */
    loc: Type.Optional(SourceLocSchema),
  }),
  /** Scene field path (e.g. `layout.padding.l`) → origin. */
  fields: Type.Record(Type.String(), FieldOriginSchema),
});
export type NodeProvenance = Static<typeof NodeProvenanceSchema>;

/** `provenance/<sid>.json` (06 §4.1). */
export const ProvenanceDocSchema = Type.Object(
  {
    kind: Type.Literal('holotype/provenance'),
    v: Type.Literal(1),
    sid: Type.String({ minLength: 1 }),
    /** `vk` → `nk` → provenance. */
    nodes: Type.Record(Type.String(), Type.Record(Type.String(), NodeProvenanceSchema)),
  },
  { title: 'Holotype provenance side file (ProvenanceDoc)' },
);
export type ProvenanceDoc = Static<typeof ProvenanceDocSchema>;

/** Component → code identity (15 §5.3), from the Storybook model (03). */
export const CodeRefSchema = Type.Object({
  sid: Type.String({ minLength: 1 }),
  /** e.g. `Button`. */
  exportName: Type.Optional(Type.String()),
  /** The module the component is imported from, e.g. `src/components/Button/Button.tsx`. */
  importPath: Type.Optional(Type.String()),
  /** `index.json` `importPath` of the CSF file. */
  storiesPath: Type.String({ minLength: 1 }),
  storyIds: Type.Array(Type.String()),
  /** Nearest `package.json` name, e.g. `@acme/ui`. */
  package: Type.Optional(Type.String()),
});
export type CodeRef = Static<typeof CodeRefSchema>;
