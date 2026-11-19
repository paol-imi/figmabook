/// <reference lib="dom" />
/*
 * Story metadata, page side (03 §4.1). Self-contained like every page function: Playwright
 * serializes it with `Function.prototype.toString`.
 */
import type { JsonValue } from '@holotype/ir';

/** Limits of the structured serializer (03 §4.1). */
export interface SafeLimits {
  readonly maxDepth: number;
  readonly maxArray: number;
}

/** 03 §4.1: depth 8, 200 array items. */
export const SAFE_LIMITS: SafeLimits = { maxDepth: 8, maxArray: 200 };

/** What `loadStory` gave for one story, made JSON-safe in the page. */
export interface RawStoryMeta {
  readonly id: string;
  readonly title: string;
  readonly name: string;
  readonly tags: readonly string[];
  /** Merged project < meta < story by Storybook; JSON-safe. */
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly argTypes: Readonly<Record<string, JsonValue>>;
  readonly initialArgs: Readonly<Record<string, JsonValue>>;
  /** The args the story export itself declares. */
  readonly storyArgs: Readonly<Record<string, JsonValue>>;
  readonly storyGlobals: Readonly<Record<string, JsonValue>>;
  /** argType keys written in the project, meta or story annotations (not inferred). */
  readonly declaredArgTypes: readonly string[];
  /** Props the inline docgen (`component.__docgenInfo`) knows. */
  readonly docgenProps: readonly string[];
  /** The component's docgen or display name, when there is one. */
  readonly componentName?: string;
  readonly subcomponents: readonly string[];
  readonly hasPlay: boolean;
  readonly usesMount: boolean;
}

export type RawStoryResult = RawStoryMeta | { readonly error: string };

/**
 * Reads the metadata of `ids` with per-id `loadStory` (never `extract()`, which imports every
 * CSF file, 03 §4.1). Non-JSON values become markers: `{$fn}`, `{$node}`, `{$obj}`, `{$cycle}`,
 * `{$date}`, `{$undef}`, `{$sym}`, `{$truncated}`, plus `{$regexp: "/source/flags"}` (the config
 * pattern form, 16 §1), `{$num}` for NaN and infinities and `{$bigint}`.
 */
export async function readStoryMetas(arg: {
  readonly ids: readonly string[];
  readonly limits: SafeLimits;
}): Promise<Record<string, RawStoryResult>> {
  type Annotations = { argTypes?: Record<string, unknown>; args?: Record<string, unknown> };
  type Story = {
    id: string;
    title: string;
    name: string;
    tags?: string[];
    parameters?: Record<string, unknown>;
    argTypes?: Record<string, unknown>;
    initialArgs?: Record<string, unknown>;
    storyGlobals?: Record<string, unknown>;
    globals?: Record<string, unknown>;
    component?: unknown;
    subcomponents?: Record<string, unknown>;
    moduleExport?: unknown;
    playFunction?: unknown;
    usesMount?: boolean;
  };
  type Store = {
    loadCSFFileByStoryId?: (storyId: string) => Promise<{ meta?: Annotations; stories?: Record<string, Annotations> }>;
    projectAnnotations?: Annotations;
  };
  type Preview = {
    ready?: () => Promise<void>;
    loadStory(options: { storyId: string }): Promise<Story>;
    storyStoreValue?: Store;
  };
  const { maxDepth, maxArray } = arg.limits;
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

  const safe = (value: unknown, depth = 0, seen: object[] = []): JsonValue => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : { $num: String(value) };
    if (value === undefined) return { $undef: true };
    if (typeof value === 'bigint') return { $bigint: String(value) };
    if (typeof value === 'symbol') return { $sym: value.description ?? '' };
    if (typeof value === 'function') return { $fn: (value as { name?: string }).name ?? '' };
    if (typeof value !== 'object') return null;
    if (seen.includes(value)) return { $cycle: true };
    if (depth >= maxDepth) return { $truncated: 'depth' };
    const record = value as Record<string, unknown>;
    if ('$$typeof' in record) {
      const type = record.type as { displayName?: string; name?: string } | string | undefined;
      const name = typeof type === 'string' ? type : (type?.displayName ?? type?.name ?? '');
      return { $node: 'react', type: name };
    }
    if (record.__v_isVNode === true) return { $node: 'vue' };
    if (typeof Node !== 'undefined' && value instanceof Node) {
      return { $node: 'dom', tag: (value as Element).tagName?.toLowerCase() ?? value.nodeName.toLowerCase() };
    }
    if (value instanceof Date) return { $date: Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString() };
    if (value instanceof RegExp) return { $regexp: `/${value.source}/${value.flags}` };
    const inner = [...seen, value];
    if (Array.isArray(value)) {
      const items = value.slice(0, maxArray).map((item) => safe(item, depth + 1, inner));
      return value.length > maxArray ? [...items, { $truncated: value.length - maxArray }] : items;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      return { $obj: (proto as { constructor?: { name?: string } }).constructor?.name ?? 'Object' };
    }
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(record)) out[key] = safe(item, depth + 1, inner);
    return out;
  };
  const safeRecord = (value: unknown): Record<string, JsonValue> => {
    const made = isRecord(value) ? safe(value) : {};
    return isRecord(made) && !Array.isArray(made) ? (made as Record<string, JsonValue>) : {};
  };
  const keys = (value: unknown): string[] => (isRecord(value) ? Object.keys(value) : []);

  const preview = (window as unknown as { __STORYBOOK_PREVIEW__: Preview }).__STORYBOOK_PREVIEW__;
  await preview.ready?.();
  const store = preview.storyStoreValue;
  const results: Record<string, RawStoryResult> = {};
  for (const storyId of arg.ids) {
    try {
      const story = await preview.loadStory({ storyId });
      const component = story.component as
        | { __docgenInfo?: { displayName?: string; props?: Record<string, unknown> }; displayName?: string }
        | undefined;
      const declared = new Set<string>(keys(store?.projectAnnotations?.argTypes));
      try {
        const csf = await store?.loadCSFFileByStoryId?.(storyId);
        for (const key of keys(csf?.meta?.argTypes)) declared.add(key);
        for (const key of keys(csf?.stories?.[storyId]?.argTypes)) declared.add(key);
      } catch {
        // Older stores: argTypes origin falls back to docgen and inference.
      }
      const exported = story.moduleExport as { args?: unknown; input?: { args?: unknown } } | undefined;
      // Not `component.name`: production builds minify it.
      const componentName = component?.__docgenInfo?.displayName ?? component?.displayName;
      results[storyId] = {
        id: story.id,
        title: story.title,
        name: story.name,
        tags: Array.isArray(story.tags) ? story.tags.filter((tag) => typeof tag === 'string') : [],
        parameters: safeRecord(story.parameters),
        argTypes: safeRecord(story.argTypes),
        initialArgs: safeRecord(story.initialArgs),
        storyArgs: safeRecord(isRecord(exported) ? (exported.args ?? exported.input?.args) : undefined),
        storyGlobals: safeRecord(story.storyGlobals ?? story.globals),
        declaredArgTypes: [...declared].sort(),
        docgenProps: keys(component?.__docgenInfo?.props).sort(),
        ...(typeof componentName === 'string' && componentName !== '' ? { componentName } : {}),
        subcomponents: keys(story.subcomponents),
        hasPlay: typeof story.playFunction === 'function',
        usesMount: story.usesMount === true,
      };
    } catch (error) {
      results[storyId] = { error: String((error as Error)?.stack ?? error) };
    }
  }
  return results;
}
