import type { CodeRef, HolotypeParams, JsonValue } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import type { Page } from 'playwright';
import { awaitPreview, CONTROLLER_KEY } from '../driver/channel-scripts';
import { ensureChannelController } from '../driver/controller';
import { Deadline, isTimeout } from '../driver/deadline';
import { renderError } from '../driver/errors';
import { componentIdFromStoryId } from '../story-id';
import type { IndexStory, SbError } from '../types';
import { type NormalizedArgType, normalizeArgTypes } from './arg-types';
import type { ComponentsManifest } from './manifest';
import { type RawStoryMeta, type RawStoryResult, readStoryMetas, SAFE_LIMITS } from './page';
import { type ParamsConfig, resolveParams } from './params';

/** One story's metadata, normalized (03 §4.4). Values that are not JSON carry 03 §4.1 markers. */
export interface StoryMeta {
  readonly id: string;
  /** `id.split('--')[0]` (README §7). */
  readonly sid: string;
  readonly title: string;
  readonly titlePath: readonly string[];
  readonly name: string;
  /** The story's export name in its CSF file (`index.json`). */
  readonly exportName?: string;
  /** `index.json` `importPath` of the CSF file. */
  readonly importPath: string;
  /** `index.json` `componentPath` (SB 10). */
  readonly componentPath?: string;
  readonly tags: readonly string[];
  /** All parameters, merged project < meta < story by Storybook. */
  readonly parameters: Readonly<Record<string, JsonValue>>;
  /** `parameters.holotype` with every precedence layer (README §7), validated (04 §9). */
  readonly holotype: HolotypeParams;
  readonly argTypes: Readonly<Record<string, NormalizedArgType>>;
  /** The args the story export itself declares, over its meta's. */
  readonly args: Readonly<Record<string, JsonValue>>;
  /** Project + meta + story args, as Storybook renders the story first. */
  readonly initialArgs: Readonly<Record<string, JsonValue>>;
  readonly storyGlobals: Readonly<Record<string, JsonValue>>;
  /** Component → code identity (15 §5.3). */
  readonly code: CodeRef;
  readonly subcomponents: readonly string[];
  readonly hasPlay: boolean;
  readonly usesMount: boolean;
  /** `PLAN_PARAM_UNKNOWN_KEY` and `PLAN_CONFIG_INVALID` for this story's `parameters.holotype`. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface DescribeOptions extends ParamsConfig {
  /** Ids per `page.evaluate` (03 §4.1). Default 50. */
  readonly batchSize?: number;
  /** Time per batch before `SB_METADATA_TIMEOUT`. Default 30 000 ms. */
  readonly batchTimeoutMs?: number;
}

export interface DescribeResult {
  /** Every requested id, in request order: its metadata, or why it has none. */
  readonly stories: ReadonlyMap<string, StoryMeta | SbError>;
  /** Run-level diagnostics, such as `SB_MANIFEST_UNPARSEABLE`. */
  readonly diagnostics: readonly Diagnostic[];
}

export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_BATCH_TIMEOUT_MS = 30_000;

export interface DescribeContext {
  readonly baseUrl: string;
  /**
   * The origin documents record (`ConnectedStorybook.origin`): URLs on the served origin (a
   * static build's ephemeral port) are rewritten to it, so metadata is the same on every run.
   */
  readonly origin: string;
  /** Every story of the unfiltered index, by id. */
  readonly index: ReadonlyMap<string, IndexStory>;
  /** The filtered stories, in index order: `CodeRef.storyIds`. */
  readonly stories: readonly IndexStory[];
  readonly manifest?: ComponentsManifest;
  readonly diagnostics: readonly Diagnostic[];
}

/** `CodeRef` of a story (15 §5.3): the CSF path from the index, the component from the manifest. */
export function codeRefOf(
  story: IndexStory,
  stories: readonly IndexStory[],
  manifest: ComponentsManifest | undefined,
  componentName: string | undefined,
): CodeRef {
  const entry = manifest?.get(story.sid);
  const exportName = entry?.exportName ?? componentName;
  return {
    sid: story.sid,
    ...(exportName === undefined ? {} : { exportName }),
    ...(story.componentPath === undefined ? {} : { importPath: story.componentPath }),
    storiesPath: story.importPath,
    storyIds: stories.filter((other) => other.sid === story.sid).map((other) => other.id),
    ...(entry?.package === undefined ? {} : { package: entry.package }),
  };
}

/**
 * Rewrites strings that start with `served` (the origin the browser loaded, with its port) to
 * start with `origin` instead, everywhere in `value`.
 */
export function portableUrls<T extends JsonValue>(value: T, served: string, origin: string): T {
  if (served === origin) return value;
  const prefix = `${served}/`;
  const walk = (item: JsonValue): JsonValue => {
    if (typeof item === 'string') return item.startsWith(prefix) ? `${origin}/${item.slice(prefix.length)}` : item;
    if (Array.isArray(item)) return item.map(walk);
    if (item === null || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).map(([key, inner]) => [key, walk(inner)]));
  };
  return walk(value) as T;
}

/** {@link portableUrls} over every value a page read. */
function portableRaw(raw: RawStoryMeta, served: string, origin: string): RawStoryMeta {
  const fix = <T extends Readonly<Record<string, JsonValue>>>(value: T): T =>
    portableUrls(value as JsonValue, served, origin) as T;
  return {
    ...raw,
    parameters: fix(raw.parameters),
    argTypes: fix(raw.argTypes),
    initialArgs: fix(raw.initialArgs),
    storyArgs: fix(raw.storyArgs),
    storyGlobals: fix(raw.storyGlobals),
  };
}

/** Builds a {@link StoryMeta} from what the page read and the index entry. */
export function toStoryMeta(
  story: IndexStory,
  read: RawStoryMeta,
  context: Pick<DescribeContext, 'stories' | 'manifest'> & Partial<Pick<DescribeContext, 'baseUrl' | 'origin'>>,
  config: ParamsConfig,
): StoryMeta {
  const raw =
    context.baseUrl === undefined || context.origin === undefined
      ? read
      : portableRaw(read, new URL(context.baseUrl).origin, context.origin);
  const sid = componentIdFromStoryId(story.id);
  const checked = resolveParams(raw.parameters.holotype, config, { storyId: story.id, sid, title: story.title });
  return {
    id: story.id,
    sid,
    title: story.title,
    titlePath: story.titlePath,
    name: story.name,
    ...(story.exportName === undefined ? {} : { exportName: story.exportName }),
    importPath: story.importPath,
    ...(story.componentPath === undefined ? {} : { componentPath: story.componentPath }),
    tags: raw.tags,
    parameters: raw.parameters,
    holotype: checked.params,
    argTypes: normalizeArgTypes(raw.argTypes, {
      declared: new Set(raw.declaredArgTypes),
      docgen: new Set(raw.docgenProps),
    }),
    args: raw.storyArgs,
    initialArgs: raw.initialArgs,
    storyGlobals: raw.storyGlobals,
    code: codeRefOf(story, context.stories, context.manifest, raw.componentName),
    subcomponents: raw.subcomponents,
    hasPlay: raw.hasPlay,
    usesMount: raw.usesMount,
    diagnostics: checked.diagnostics,
  };
}

/**
 * Opens the preview without a story (`iframe.html?viewMode=story`: nothing renders and nothing is
 * logged, S-07 Q13) and waits for it. `undefined` when it is ready.
 */
async function bootPreview(page: Page, baseUrl: string, timeoutMs: number): Promise<SbError | undefined> {
  const url = new URL('iframe.html?viewMode=story', baseUrl).href;
  const deadline = new Deadline(timeoutMs);
  try {
    const response = await page.goto(url, { waitUntil: 'commit', timeout: deadline.remaining() });
    if (response !== null && !response.ok()) {
      return renderError('', 'SB_IFRAME_UNREACHABLE', { value: `HTTP ${response.status()}`, data: { url } });
    }
    const state = await deadline.race(page.evaluate(awaitPreview, { key: CONTROLLER_KEY, timeoutMs }), 1000);
    if (state.kind === 'timeout') {
      return renderError('', 'SB_PREVIEW_INIT_TIMEOUT', { value: `${timeoutMs} ms`, data: { url, timeoutMs } });
    }
    return undefined;
  } catch (error) {
    if (isTimeout(error)) {
      return renderError('', 'SB_PREVIEW_INIT_TIMEOUT', { value: `${timeoutMs} ms`, data: { url, timeoutMs } });
    }
    return renderError('', 'SB_IFRAME_UNREACHABLE', { value: (error as Error).message, data: { url } });
  }
}

/** Gives every id of a batch the same failure (a copy of `error` with its story id). */
function failAll(ids: readonly string[], error: SbError): Map<string, SbError> {
  return new Map(
    ids.map((id) => {
      const made = renderError(id, error.code, {
        ...(error.diagnostic.value === undefined ? {} : { value: error.diagnostic.value }),
        data: { ...error.diagnostic.data, storyId: id },
      });
      return [id, made];
    }),
  );
}

/**
 * Reads story metadata (03 §4): per-id `loadStory` on one preview page, in batches of 50; a
 * batch that hangs 30 s is retried once on a fresh page, then its stories get
 * `SB_METADATA_TIMEOUT`. A story that fails to load is `SB_STORY_LOAD_FAILED`; an id the index
 * does not list is `SB_STORY_MISSING`. `page` is the caller's; it is left on the preview.
 */
export async function describeStories(
  page: Page,
  ids: readonly string[],
  context: DescribeContext,
  options: DescribeOptions = {},
): Promise<DescribeResult> {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_BATCH_SIZE));
  const batchTimeoutMs = options.batchTimeoutMs ?? DEFAULT_BATCH_TIMEOUT_MS;
  const results = new Map<string, StoryMeta | SbError>();
  const known = ids.filter((id) => context.index.has(id));
  for (const id of ids) {
    if (!context.index.has(id)) {
      results.set(id, renderError(id, 'SB_STORY_MISSING', { value: id, data: { baseUrl: context.baseUrl } }));
    }
  }
  await ensureChannelController(page);

  let booted = false;
  for (let start = 0; start < known.length; start += batchSize) {
    const batch = known.slice(start, start + batchSize);
    let raw: Record<string, RawStoryResult> | undefined;
    let failure: SbError | undefined;
    for (let attempt = 0; attempt < 2 && raw === undefined; attempt += 1) {
      if (!booted || attempt > 0) {
        failure = await bootPreview(page, context.baseUrl, batchTimeoutMs);
        if (failure !== undefined) break;
        booted = true;
      }
      try {
        raw = await new Deadline(batchTimeoutMs).race(
          page.evaluate(readStoryMetas, { ids: batch, limits: SAFE_LIMITS }),
        );
      } catch (error) {
        if (!isTimeout(error)) throw error;
        failure = renderError('', 'SB_METADATA_TIMEOUT', {
          value: `${batchTimeoutMs} ms`,
          data: { timeoutMs: batchTimeoutMs, batch: [...batch] },
        });
        booted = false;
      }
    }
    if (raw === undefined) {
      const failed = failAll(batch, failure ?? renderError('', 'SB_METADATA_TIMEOUT'));
      for (const [id, error] of failed) results.set(id, error);
      // The preview never came up: the remaining batches would fail the same way.
      if (failure?.code === 'SB_PREVIEW_INIT_TIMEOUT' || failure?.code === 'SB_IFRAME_UNREACHABLE') {
        for (const [id, error] of failAll(known.slice(start + batchSize), failure)) results.set(id, error);
        break;
      }
      continue;
    }
    for (const id of batch) {
      const story = context.index.get(id);
      const read = raw[id];
      if (story === undefined || read === undefined) continue;
      if ('error' in read) {
        results.set(
          id,
          renderError(id, 'SB_STORY_LOAD_FAILED', {
            value: read.error.split('\n')[0] ?? '',
            data: { event: 'loadStory', message: read.error.slice(0, 4000) },
          }),
        );
      } else {
        results.set(id, toStoryMeta(story, read, context, options));
      }
    }
  }
  const ordered = new Map<string, StoryMeta | SbError>();
  for (const id of ids) {
    const result = results.get(id);
    if (result !== undefined) ordered.set(id, result);
  }
  return { stories: ordered, diagnostics: context.diagnostics };
}
