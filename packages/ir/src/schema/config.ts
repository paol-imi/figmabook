import { type Static, type TProperties, Type } from '@sinclair/typebox';
import { Enum, JsonValueSchema, PseudoClassSchema } from './primitives';

/*
 * Configuration schemas: `HolotypeParams` (04 §9), used for `parameters.holotype` at every
 * level and for `defaults` / `components[sid]`, and `HolotypeConfig` (16, D-51).
 *
 * Unlike IR documents these are *strict*: every object rejects unknown keys, which the
 * loader reports as `PLAN_PARAM_UNKNOWN_KEY` / `PLAN_CONFIG_UNKNOWN_KEY` (16 §18).
 *
 * Patterns: a JSON config writes a RegExp as a `"/pattern/flags"` string (16 §1). The
 * config validators turn RegExp instances into that form first (`normalizeConfigInput`), so
 * the schema and the validated value only ever hold strings; `parsePattern` turns one back.
 */

const Strict = { additionalProperties: false } as const;

/** A strict object whose keys are all optional unless wrapped in `Required`. */
const S = <T extends TProperties>(properties: T) => Type.Object(properties, Strict);
const O = Type.Optional;

/** A plain string, or `"/pattern/flags"` for a regular expression. */
export const PatternSchema = Type.String({ description: 'A string, or "/pattern/flags" for a regular expression' });

const PATTERN_FORM = /^\/(.*)\/([dgimsuvy]*)$/s;

/** Writes a RegExp in the JSON config form `"/pattern/flags"`. */
export function patternToString(pattern: RegExp): string {
  return `/${pattern.source}/${pattern.flags}`;
}

/** Reads a config pattern: `"/pattern/flags"` becomes a RegExp, anything else stays a string. */
export function parsePattern(pattern: string): RegExp | string {
  const match = PATTERN_FORM.exec(pattern);
  return match ? new RegExp(match[1] ?? '', match[2]) : pattern;
}

// ---------------------------------------------------------------------------------------
// HolotypeParams (04 §9)
// ---------------------------------------------------------------------------------------

export const ArgHintSchema = S({
  as: O(Enum('variant', 'boolean', 'text', 'instance-swap', 'slot', 'fixed', 'ignore')),
  /** Figma property or axis name. */
  name: O(Type.String()),
  /** Explicit values (enables numbers and strings as axes). */
  values: O(Type.Array(JsonValueSchema)),
  labels: O(Type.Record(Type.String(), Type.String())),
  order: O(Enum('options', 'default-first')),
  /** Selector of the node to bind (text, boolean, slot). */
  target: O(Type.String()),
});
export type ArgHint = Static<typeof ArgHintSchema>;

export const StatesParamsSchema = S({
  include: O(Type.Array(Type.Union([PseudoClassSchema, Type.Literal('default')]))),
  foldBooleans: O(Type.Array(Type.String())),
  labels: O(Type.Record(Type.String(), Type.String())),
  /** Same strings as Capture IR `PseudoStateSpec.method` (06). */
  mode: O(Enum('force', 'addon', 'interact')),
  /** Selector of the element that receives the state (04 §6.3). */
  target: O(Type.String()),
  includePortals: O(Type.Boolean()),
});

const ViewportSizeSchema = S({ width: Type.Number({ minimum: 0 }), height: O(Type.Number({ minimum: 0 })) });

const holotypeParamsProperties = {
  /** Same as the tag `!figma`. */
  disable: O(Type.Boolean()),
  /** Figma component display name. */
  name: O(Type.String()),
  /** Regroup into another component id. */
  component: O(Type.String()),
  strategy: O(Enum('auto', 'stories', 'args', 'curated')),
  /** Story export name or id. */
  baseStory: O(Type.String()),
  matrix: O(Enum('auto', 'full', 'pairwise', 'one-at-a-time', 'curated')),
  classification: O(Enum('verify', 'fast')),
  args: O(Type.Record(Type.String(), ArgHintSchema)),
  /** Args pinned for all variants. */
  fixed: O(Type.Record(Type.String(), JsonValueSchema)),
  /** Curated combinations (axis name → label). */
  variants: O(Type.Array(Type.Record(Type.String(), Type.String()))),
  /** Combinations to skip (axis name → label). */
  excludeCombos: O(Type.Array(Type.Record(Type.String(), Type.String()))),
  /** One component per value (icons); automatic for icon enums (`PLAN_ICON_SPLIT`). */
  split: O(Type.Boolean()),
  states: O(Type.Union([Type.Literal(false), StatesParamsSchema])),
  modes: O(
    S({
      /** Which globals are mode dimensions. */
      globals: O(Type.Array(Type.String())),
      values: O(Type.Record(Type.String(), Type.Array(JsonValueSchema))),
      as: O(Enum('variables', 'axis')),
      capture: O(Enum('per-variant', 'base-only')),
    }),
  ),
  viewports: O(
    S({
      sizes: Type.Record(Type.String(), Type.Union([Type.Number({ minimum: 0 }), ViewportSizeSchema])),
      as: O(Enum('axis', 'components')),
    }),
  ),
  width: O(Type.Union([Type.Literal('hug'), Type.Number({ minimum: 0 }), S({ probe: Type.Array(Type.Number()) })])),
  height: O(Type.Union([Type.Literal('hug'), Type.Number({ minimum: 0 })])),
  viewport: O(ViewportSizeSchema),
  rootSelector: O(Type.String()),
  unwrap: O(Type.Union([Type.Boolean(), Type.Integer({ minimum: 0 })])),
  portal: O(
    Type.Union([
      Type.Boolean(),
      Type.Literal('auto'),
      Type.String(),
      S({ selector: O(Type.String()), frame: O(Enum('union', 'viewport')) }),
    ]),
  ),
  /** CSS selectors removed from capture (not the top-level `exclude`, which filters stories). */
  exclude: O(Type.Array(Type.String())),
  stateTarget: O(Type.String()),
  slots: O(
    Type.Record(
      Type.String(),
      S({ selector: O(Type.String()), min: O(Type.Integer({ minimum: 0 })), max: O(Type.Integer({ minimum: 0 })) }),
    ),
  ),
  /** Set grid placement by axis name (04 §8). */
  grid: O(S({ columns: O(Type.Array(Type.String())), rows: O(Type.Array(Type.String())) })),
  stories: O(
    S({
      fillMatrix: O(Enum('none', 'budget', 'full')),
      maxStoryAxisValues: O(Type.Integer({ minimum: 1 })),
    }),
  ),
  /** D-28, 04 §5.2. Defaults: max 256, warn 128, hardLimit 1024, maxProbes 120. */
  budget: O(
    S({
      max: O(Type.Integer({ minimum: 1 })),
      warn: O(Type.Integer({ minimum: 1 })),
      hardLimit: O(Type.Integer({ minimum: 1 })),
      maxProbes: O(Type.Integer({ minimum: 0 })),
    }),
  ),
  conditional: O(Enum('dense', 'sparse')),
  play: O(Enum('initial-only', 'rerun')),
  remount: O(Type.Boolean()),
  delay: O(Type.Number({ minimum: 0 })),
  keepLayout: O(Type.Boolean()),
  /** D-17, used by the mapper (07). */
  textMode: O(Enum('reflow', 'locked-lines')),
  /** DCR item ids this story implements (D-37, 15 §8). */
  implements: O(Type.Array(Type.String({ minLength: 1 }))),
  /** Deprecation target (15 §4.13): a sid, or a sid with an arg map. */
  replacedBy: O(
    Type.Union([
      Type.String({ minLength: 1 }),
      S({ sid: Type.String({ minLength: 1 }), args: O(Type.Record(Type.String(), Type.String())) }),
    ]),
  ),
  /** Enables the in-preview capture hook (03 §11). */
  channelCapture: O(Type.Boolean()),
};

/** `parameters.holotype` and `defaults` / `components[sid]` (04 §9). */
export const HolotypeParamsSchema = Type.Object(holotypeParamsProperties, {
  ...Strict,
  title: 'Holotype story parameters (HolotypeParams)',
});
export type HolotypeParams = Static<typeof HolotypeParamsSchema>;

/** `components[sid]`: `HolotypeParams` plus the one project-only key (10 §9.2). */
export const ComponentConfigSchema = Type.Object(
  { ...holotypeParamsProperties, conflicts: O(Enum('keep', 'overwrite', 'fork')) },
  Strict,
);
export type ComponentConfig = Static<typeof ComponentConfigSchema>;

// ---------------------------------------------------------------------------------------
// Project namespaces (16 §4–§17)
// ---------------------------------------------------------------------------------------

export const StorybookConfigSchema = S({
  /** URL or static build directory. */
  source: Type.String({ minLength: 1 }),
  dev: O(S({ url: O(Type.String()), command: O(Type.String()), autoStart: O(Type.Boolean()) })),
  auth: O(
    S({
      storageState: O(Type.String()),
      /** Header name → env variable name; never a value. */
      headersFromEnv: O(Type.Record(Type.String(), Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }))),
    }),
  ),
  refs: O(Type.Array(Type.String())),
  requireTag: O(Type.Boolean()),
});

export const CaptureConfigSchema = S({
  dpr: O(Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)])),
  locale: O(Type.String()),
  timezone: O(Type.String()),
  clock: O(Type.Union([Type.String(), Type.Literal(false)])),
  animations: O(Enum('finish', 'pause-only')),
  determinism: O(S({ random: O(Type.Boolean()) })),
  svg: O(S({ rasterizeFilters: O(Type.Boolean()) })),
  rasterize: O(Type.Array(Type.String())),
  workers: O(Type.Union([Type.Integer({ minimum: 1 }), Type.Literal('auto')])),
  devSourcemap: O(Enum('force', 'keep')),
});

export const MapperConfigSchema = S({
  keepInvisible: O(Type.Boolean()),
  borderModel: O(Enum('padding-plus-border', 'native')),
  allowSpacers: O(Type.Boolean()),
  exactBorders: O(Type.Boolean()),
  exactRadii: O(Type.Boolean()),
  preferFrames: O(Type.Boolean()),
  alignment: O(S({ maxPlaceholdersRatio: O(Type.Number({ minimum: 0, maximum: 1 })) })),
  colorProfile: O(Enum('auto', 'srgb', 'display-p3')),
  nativeControls: O(Enum('synthesize', 'raster')),
});
export type MapperConfig = Static<typeof MapperConfigSchema>;

export const LayoutConfigSchema = S({
  autoLayout: O(Enum('verified', 'off')),
  tolerancePx: O(Type.Number({ minimum: 0 })),
  margins: O(Type.Literal('normalize')),
  textWrap: O(Enum('reflow', 'locked-lines')),
  probing: O(S({ enabled: O(Type.Boolean()), widths: O(Type.Array(Type.Number({ exclusiveMinimum: 0 }))) })),
});
export type LayoutConfig = Static<typeof LayoutConfigSchema>;

export const NamingConfigSchema = S({
  layers: O(Type.Array(Type.String())),
  stripClassPatterns: O(Type.Array(PatternSchema)),
  iconSlug: O(Enum('role', 'boundary')),
});
export type NamingConfig = Static<typeof NamingConfigSchema>;

export const TokensConfigSchema = S({
  enabled: O(Type.Boolean()),
  include: O(Enum('referenced', 'all')),
  /** Globs on CSS names, e.g. `['--color-*']`. */
  includePatterns: O(Type.Array(Type.String())),
  /** Merged with the built-in `[/^--tw-/, /^--radix-/]`. */
  ignore: O(Type.Array(PatternSchema)),
  stripPrefix: O(Type.String()),
  naming: O(Enum('dash-groups', 'flat', 'all-dashes')),
  /** `.ts`/`.js` configs only. */
  rename: O(Type.Function([Type.String()], Type.String())),
  collections: O(Type.Union([Enum('tiered', 'single'), S({ groups: Type.Array(JsonValueSchema) })])),
  collectionName: O(Type.String()),
  modes: O(
    Type.Array(S({ name: Type.String({ minLength: 1 }), globals: Type.Record(Type.String(), JsonValueSchema) })),
  ),
  modeOverflow: O(Enum('variant-axis', 'extend', 'split', 'first-only')),
  themeFallback: O(Enum('variant-axis', 'report')),
  modeProbeVariants: O(Type.Union([Enum('default-variant', 'all'), Type.Integer({ minimum: 1 })])),
  bindByValue: O(Type.Boolean()),
  matchByValue: O(Type.Boolean()),
  libraryProbeLimit: O(Type.Integer({ minimum: 0 })),
  textStyles: O(Type.Union([Type.Literal(false), Enum('tokens', 'classes', 'dedupe')])),
  effectStyles: O(Type.Boolean()),
  paintStyles: O(Type.Boolean()),
  hidePrimitives: O(Type.Boolean()),
  scopes: O(Enum('infer', 'all')),
  lineHeight: O(Type.Literal('px-per-usage')),
  motion: O(Type.Boolean()),
  /** DTCG / Style Dictionary / Tokens Studio paths. */
  source: O(Type.Union([Type.String(), Type.Array(Type.String())])),
  /** `.ts`/`.js` configs only. */
  cssName: O(Type.Function([Type.Array(Type.String())], Type.String())),
});

export const FontsConfigSchema = S({
  map: O(
    Type.Record(Type.String(), Type.Union([Type.String(), S({ family: Type.String(), style: O(Type.String()) })])),
  ),
  fallback: O(Type.String()),
});

export const FigmaGridConfigSchema = S({
  maxColumns: O(Type.Integer({ minimum: 1 })),
  gap: O(Type.Number({ minimum: 0 })),
  padding: O(Type.Number({ minimum: 0 })),
});

export const FigmaConfigSchema = S({
  page: O(Type.String()),
  sections: O(Enum('by-root-title', 'none')),
  docFrames: O(Type.Boolean()),
  docSections: O(Type.Array(Enum('description', 'properties', 'diagnostics'))),
  iconsPage: O(Type.String()),
  deprecatedPage: O(Type.String()),
  prototypeStates: O(Type.Boolean()),
  grid: O(FigmaGridConfigSchema),
  files: O(Type.Array(S({ name: Type.String({ minLength: 1 }), include: Type.Array(Type.String()) }))),
});

export const SyncConfigSchema = S({
  conflicts: O(Enum('keep', 'overwrite', 'fork')),
  orphans: O(Enum('remove', 'hide')),
  pruneAfterDays: O(Type.Integer({ minimum: 0 })),
  undo: O(Enum('per-component', 'single')),
});

/** `dcr.scope` string form (16 §15); parses to `DcrScope` (15). `selection:` is plugin-only. */
export const DcrScopeStringSchema = Type.Union([
  Enum('changed', 'ready', 'all'),
  // biome-ignore lint/suspicious/noTemplateCurlyInString: TypeBox template-literal syntax.
  Type.TemplateLiteral('page:${string}'),
]);
export type DcrScopeString = Static<typeof DcrScopeStringSchema>;

export const DcrConfigSchema = S({
  scope: O(DcrScopeStringSchema),
  requireApproval: O(Type.Boolean()),
  targets: O(
    S({
      components: O(S({ package: O(Type.String()) })),
      screens: O(S({ repo: Type.String({ minLength: 1 }), path: Type.String() })),
    }),
  ),
  screens: O(
    S({
      separator: O(Type.String()),
      groupBySection: O(Type.Boolean()),
      breakpoints: O(Type.Record(Type.String(), Type.Number({ minimum: 0 }))),
      states: O(Type.Record(Type.String(), Type.Array(Type.String()))),
      base: O(Enum('widest', 'narrowest')),
      expectStates: O(Type.Array(Type.String())),
    }),
  ),
  content: O(S({ placeholders: O(Type.Array(PatternSchema)), i18n: O(Enum('auto', 'none', 'keys')) })),
  a11y: O(S({ categories: O(Type.Array(Type.String())) })),
  /** Old sid → replacement sid. */
  deprecations: O(Type.Record(Type.String(), Type.String())),
});
export type DcrConfig = Static<typeof DcrConfigSchema>;

export const VerifyConfigSchema = S({
  visual: O(Enum('advisory', 'gate')),
  tolerance: O(S({ px: O(Type.Number({ minimum: 0 })), color: O(Type.Number({ minimum: 0 })) })),
  screens: O(Type.Boolean()),
  regressions: O(Type.Boolean()),
});

/** `holotype.config.ts` (16 §2). Only `storybook.source` is required. */
export const HolotypeConfigSchema = Type.Object(
  {
    storybook: StorybookConfigSchema,
    /** Story filters: globs on the title path and story id. */
    include: O(Type.Array(Type.String())),
    exclude: O(Type.Array(Type.String())),
    defaults: O(HolotypeParamsSchema),
    /** sid or glob → params. Later entries win. */
    components: O(Type.Record(Type.String(), ComponentConfigSchema)),
    capture: O(CaptureConfigSchema),
    mapper: O(MapperConfigSchema),
    layout: O(LayoutConfigSchema),
    naming: O(NamingConfigSchema),
    tokens: O(TokensConfigSchema),
    fonts: O(FontsConfigSchema),
    figma: O(FigmaConfigSchema),
    sync: O(SyncConfigSchema),
    dcr: O(DcrConfigSchema),
    verify: O(VerifyConfigSchema),
    output: O(S({ dir: O(Type.String()), report: O(Type.Array(Enum('json', 'html'))) })),
    cache: O(S({ dir: O(Type.String()) })),
    telemetry: O(Type.Boolean()),
    redaction: O(S({ inputs: O(Enum('password', 'all')), text: O(Enum('off', 'mask')) })),
    compat: O(S({ s2d: O(Type.Boolean()) })),
  },
  { ...Strict, title: 'Holotype config (HolotypeConfig)' },
);
export type HolotypeConfig = Static<typeof HolotypeConfigSchema>;

// ---------------------------------------------------------------------------------------
// Resolved `dcr` config (D-50): written to `BundleManifest.branch.dcrConfig`, copied by the
// plugin to `branch:meta`, hashed by both sides into `configHash`.
// ---------------------------------------------------------------------------------------

export const ResolvedDcrConfigSchema = Type.Object({
  scope: DcrScopeStringSchema,
  requireApproval: Type.Boolean(),
  targets: Type.Object({
    /** `package` absent = the components' nearest `package.json` name, filled by the CLI. */
    components: Type.Object({ package: O(Type.String()) }),
    /** Absent = screens live in this repo. */
    screens: O(Type.Object({ repo: Type.String({ minLength: 1 }), path: Type.String() })),
  }),
  screens: Type.Object({
    separator: Type.String(),
    groupBySection: Type.Boolean(),
    breakpoints: Type.Record(Type.String(), Type.Number({ minimum: 0 })),
    /** Key order is the render order. */
    states: Type.Record(Type.String(), Type.Array(Type.String())),
    base: Enum('widest', 'narrowest'),
    expectStates: Type.Array(Type.String()),
  }),
  content: Type.Object({ placeholders: Type.Array(PatternSchema), i18n: Enum('auto', 'none', 'keys') }),
  a11y: Type.Object({ categories: Type.Array(Type.String()) }),
  deprecations: Type.Record(Type.String(), Type.String()),
});
export type ResolvedDcrConfig = Static<typeof ResolvedDcrConfigSchema>;

/** Built-in `dcr` defaults (16 §15). */
export const DEFAULT_DCR_CONFIG: ResolvedDcrConfig = {
  scope: 'changed',
  requireApproval: false,
  targets: { components: {} },
  screens: {
    separator: ' / ',
    groupBySection: true,
    breakpoints: { Mobile: 0, Tablet: 768, Desktop: 1280 },
    states: {
      default: ['Default', 'Filled'],
      empty: ['Empty'],
      loading: ['Loading', 'Skeleton'],
      error: ['Error'],
      success: ['Success'],
    },
    base: 'widest',
    expectStates: [],
  },
  content: { placeholders: [], i18n: 'auto' },
  a11y: { categories: ['Accessibility', 'A11y'] },
  deprecations: {},
};

/**
 * Applies the built-in defaults to a (validated) `dcr` config section. Objects merge,
 * arrays and records replace (16 §1). Pure; the result is what `configHash` covers.
 */
export function resolveDcrConfig(config: DcrConfig = {}): ResolvedDcrConfig {
  const d = DEFAULT_DCR_CONFIG;
  const screensTarget = config.targets?.screens;
  const componentsPackage = config.targets?.components?.package;
  return {
    scope: config.scope ?? d.scope,
    requireApproval: config.requireApproval ?? d.requireApproval,
    targets: {
      components: componentsPackage === undefined ? {} : { package: componentsPackage },
      ...(screensTarget === undefined ? {} : { screens: { ...screensTarget } }),
    },
    screens: {
      separator: config.screens?.separator ?? d.screens.separator,
      groupBySection: config.screens?.groupBySection ?? d.screens.groupBySection,
      breakpoints: { ...(config.screens?.breakpoints ?? d.screens.breakpoints) },
      states: cloneRecordOfArrays(config.screens?.states ?? d.screens.states),
      base: config.screens?.base ?? d.screens.base,
      expectStates: [...(config.screens?.expectStates ?? d.screens.expectStates)],
    },
    content: {
      placeholders: [...(config.content?.placeholders ?? d.content.placeholders)],
      i18n: config.content?.i18n ?? d.content.i18n,
    },
    a11y: { categories: [...(config.a11y?.categories ?? d.a11y.categories)] },
    deprecations: { ...(config.deprecations ?? d.deprecations) },
  };
}

function cloneRecordOfArrays(record: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(record).map(([key, values]) => [key, [...values]]));
}

/**
 * Prepares a loaded config value for validation: every RegExp instance becomes its
 * `"/pattern/flags"` string (16 §1). Functions and everything else are kept as they are.
 */
export function normalizeConfigInput(value: unknown): unknown {
  if (value instanceof RegExp) return patternToString(value);
  if (Array.isArray(value)) return value.map(normalizeConfigInput);
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeConfigInput(item)]));
  }
  return value;
}
