import type { Diagnostic } from '@holotype/shared';
import type { CaptureDoc } from './schema/capture';
import type { LayoutConfig, MapperConfig } from './schema/config';
import type { JsonValue, PseudoClass, SourceLoc } from './schema/primitives';
import type { CodeRef, ProvenanceDoc } from './schema/provenance';
import type { PropertyType, SceneComponent, SceneComponentMeta, ScenePropertyDef } from './schema/scene';
import type { TokensDoc } from './schema/tokens';

/*
 * Stage-boundary types of the CLI pipeline (06 §1.1, 07 §0): storybook → planner → capture →
 * mapper. They live here so the mapper imports only `ir` (BUILD §11 row 6). They are
 * in-process values, never written to a bundle, so they are plain types, not schemas.
 */

export type { CodeRef };

/** Why the planner took a decision (04 §1). */
export type ProvenanceTag =
  | 'config'
  | 'parameters'
  | 'stories'
  | 'argTypes'
  | 'verified-diff'
  | 'heuristic'
  | 'compat:s2d'
  | 'compat:chromatic';

/** The storybook adapter's identity of a component (03 §7.2). */
export interface ComponentIdentity {
  readonly sid: string;
  readonly displayName: string;
  readonly description?: string;
  readonly importPath: string;
  readonly componentPath?: string;
  readonly exportName?: string;
  readonly framework: string;
  /** Web components. */
  readonly tagName?: string;
  /** `meta.docgen`. */
  readonly docgenSource?: string;
}

/**
 * Component metadata the storybook adapter hands to the mapper (03 → 07): everything the
 * mapper needs for `SceneComponentMeta` and, in branch mode, the `CodeRef` (15 §5.3).
 */
export interface ComponentMetaInput {
  readonly sid: string;
  readonly identity: ComponentIdentity;
  readonly titlePath: readonly string[];
  readonly description: string;
  readonly descriptionSource: SceneComponentMeta['descriptionSource'];
  readonly links: readonly { readonly label: string; readonly url: string }[];
  readonly storyIds: readonly string[];
  readonly code: CodeRef;
}

/** A Figma VARIANT axis (04 §1). `values[0]` is the default. */
export interface PlanAxis {
  /** Stable, e.g. `arg:variant`, `state`, `story`, `viewport`, `global:theme`. */
  readonly id: string;
  /** Figma property name, e.g. `Variant`. */
  readonly name: string;
  readonly source:
    | { readonly kind: 'arg'; readonly arg: string }
    | { readonly kind: 'story' }
    | { readonly kind: 'state' }
    | { readonly kind: 'viewport' }
    | { readonly kind: 'global'; readonly global: string }
    | { readonly kind: 'custom'; readonly id: string };
  readonly values: readonly PlanAxisValue[];
}

export interface PlanAxisValue {
  /** Figma value string, sanitized and unique within the axis. */
  readonly label: string;
  readonly bind: {
    readonly args?: Readonly<Record<string, JsonValue>>;
    readonly storyId?: string;
    readonly state?: PseudoClass;
    readonly viewport?: { readonly width: number; readonly height?: number };
    readonly globals?: Readonly<Record<string, JsonValue>>;
  };
}

/** The outcome of render-and-diff for one arg (04 §4.2). */
export interface VerificationResult {
  readonly status: 'verified' | 'unverified' | 'rejected';
  /** The decision rule that applied, R0–R6. */
  readonly rule: 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';
  /** Probe renders it is based on (`ProbeRender.id`). */
  readonly probes: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
}

/** A BOOLEAN, TEXT, INSTANCE_SWAP or SLOT property (04 §1). */
export interface PlannedProperty {
  readonly kind: Exclude<PropertyType, 'VARIANT'>;
  /** Figma property display name. */
  readonly name: string;
  readonly arg: string;
  readonly defaultValue: boolean | string | { readonly ref: string };
  readonly preferredValues?: readonly { readonly ref: string; readonly label: string }[];
  readonly verification: VerificationResult;
}

/** The render behind one variant or probe (04 §1). */
export interface PlannedRender {
  readonly storyId: string;
  readonly args: Readonly<Record<string, JsonValue>>;
  readonly globals: Readonly<Record<string, JsonValue>>;
  readonly state?: PseudoClass;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly remount?: boolean;
}

export interface PlannedVariant {
  /** Variant key (06 §6). */
  readonly vk: string;
  /** Axis id → `PlanAxisValue.label`. */
  readonly values: Readonly<Record<string, string>>;
  readonly render: PlannedRender;
  readonly isDefault: boolean;
}

/** A classification-only render (04 §4.1): captured cheaply, never emitted. */
export interface ProbeRender {
  readonly id: string;
  /** The arg under test and the value it is rendered with. */
  readonly arg: string;
  readonly value: JsonValue;
  readonly render: PlannedRender;
}

/** Themes → variable modes (04 §7.1). */
export interface ModePlan {
  readonly dimensions: readonly {
    readonly global: string;
    readonly values: readonly { readonly value: JsonValue; readonly label: string }[];
  }[];
  readonly strategy: 'variables' | 'axis';
  readonly capturedAs: 'per-variant' | 'base-only';
}

/** Budget outcome (04 §5.2); the report shows it as `planner.budget` (06 §4.4). */
export interface BudgetReport {
  readonly requested: number;
  readonly emitted: number;
  readonly strategy: 'auto' | 'full' | 'pairwise' | 'one-at-a-time' | 'curated';
  readonly droppedAxes: readonly string[];
}

/** Planner output for one component (04 §1); its canonical hash is `planHash`. */
export interface ComponentPlan {
  readonly sid: string;
  readonly identity: ComponentIdentity;
  /** Story whose `initialArgs` define the default variant. */
  readonly baseStoryId: string;
  readonly axes: readonly PlanAxis[];
  readonly properties: readonly PlannedProperty[];
  readonly fixedArgs: Readonly<Record<string, JsonValue>>;
  readonly variants: readonly PlannedVariant[];
  readonly probes: readonly ProbeRender[];
  readonly modes: ModePlan | null;
  /** Axis ids placed on x / y in the set. */
  readonly layoutGrid: { readonly columns: readonly string[]; readonly rows: readonly string[] };
  readonly budget: BudgetReport;
  readonly provenance: Readonly<Record<string, ProvenanceTag>>;
  readonly diagnostics: readonly Diagnostic[];
}

/** From the token resolver (08): CSS custom property → variable, for exact `var()` bindings. */
export interface TokenResolution {
  /** The `tokens.json` the bindings refer to; `null` when tokens are off. */
  readonly tokens: TokensDoc | null;
  /** CSS name (`--color-primary-500`) → variable key (`var:color/primary-500`). */
  readonly byCssName: Readonly<Record<string, string>>;
}

/** A component the mapper may instance (D-21): its properties and variants. */
export interface CatalogComponent {
  readonly sid: string;
  readonly name: string;
  readonly properties: readonly ScenePropertyDef[];
  /** VARIANT key → value, per variant. */
  readonly variants: readonly { readonly vk: string; readonly values: Readonly<Record<string, string>> }[];
  /** Published key when the component comes from a library (`library-refs`). */
  readonly libraryKey?: string;
}

/** Components available for instancing, by sid. */
export type ComponentCatalog = ReadonlyMap<string, CatalogComponent>;

/** Resolved per-component mapper settings (16 precedence, defaults applied by the CLI). */
export interface MapperSettings {
  readonly mapper: Required<Omit<MapperConfig, 'alignment'>> & {
    readonly alignment: { readonly maxPlaceholdersRatio: number };
  };
  readonly layout: Required<Omit<LayoutConfig, 'probing'>> & {
    readonly probing: { readonly enabled: boolean; readonly widths: readonly number[] };
  };
  readonly naming: {
    readonly layers: readonly string[];
    /** `"/pattern/flags"` or plain strings (16 §1); `parsePattern` reads them. */
    readonly stripClassPatterns: readonly string[];
    readonly iconSlug: 'role' | 'boundary';
  };
  /** `figma.grid` (16 §13). */
  readonly grid: { readonly maxColumns: number; readonly gap: number; readonly padding: number };
  /** `defaults.textMode`, else `layout.textWrap` (D-17). */
  readonly textMode: 'reflow' | 'locked-lines';
  /** `tokens.bindByValue` (D-18). */
  readonly bindByValue: boolean;
}

/** Everything `mapComponent` needs for one component (07 §0). */
export interface MapperInput {
  readonly sid: string;
  readonly meta: ComponentMetaInput;
  readonly plan: ComponentPlan;
  /** vk → capture. */
  readonly captures: ReadonlyMap<string, CaptureDoc>;
  readonly tokens: TokenResolution;
  readonly components: ComponentCatalog;
  readonly config: MapperSettings;
  /** Branch mode: `styleSheetId:startLine:startColumn` → source-mapped rule location (07 §16.1). */
  readonly sourceLocs?: ReadonlyMap<string, SourceLoc>;
}

export interface MapperOutput {
  readonly scene: SceneComponent;
  /** Branch mode only (07 §16.1). */
  readonly provenance?: ProvenanceDoc;
  readonly diagnostics: readonly Diagnostic[];
}

/** Key of `MapperInput.sourceLocs` for a captured rule range. */
export function sourceLocKey(styleSheetId: string, startLine: number, startColumn: number): string {
  return `${styleSheetId}:${startLine}:${startColumn}`;
}
