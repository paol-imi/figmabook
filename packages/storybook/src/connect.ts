import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJSON, sha256Hex } from '@holotype/ir';
import { createDiagnostic, type Diagnostic, diagnostic, type Err, err, ok, type Result } from '@holotype/shared';
import type { Page } from 'playwright';
import { checkStorybookVersion, detectCapabilities, parseProjectJson } from './capabilities';
import { createUrlDriver } from './driver/url-driver';
import { filterStories } from './filter';
import { describeOutcome, type FetchOutcome, fetchText, parseJsonBody } from './http';
import { type ParsedIndex, parseStoriesJsonV3, parseStoryIndex } from './index-json';
import { normalizeStorybookUrl, parseSource } from './source';
import { type StaticServer, startStaticServer } from './static-server';
import type {
  DriverOptions,
  IndexStory,
  RenderDriver,
  SbCapabilities,
  StorybookModel,
  StorybookSource,
  StoryFilter,
} from './types';

export interface ConnectOptions {
  /** A static build directory or a Storybook URL; a string is read with {@link parseSource}. */
  readonly source: StorybookSource | string;
  /** `storybook.requireTag` and the top-level `include` / `exclude` (16 §4–§5). */
  readonly filter?: StoryFilter;
  /** Timeout of each discovery request. Default 10 000 ms. */
  readonly requestTimeoutMs?: number;
}

/** A discovered Storybook (03 §2–3): its model, plus render drivers for Playwright pages. */
export interface ConnectedStorybook {
  readonly baseUrl: string;
  readonly caps: SbCapabilities;
  readonly model: StorybookModel;
  /** Warnings from discovery, such as `SB_VERSION_UNTESTED`. */
  readonly diagnostics: readonly Diagnostic[];
  /** The filtered stories, in index order (03 §2.2). */
  listStories(): Promise<readonly IndexStory[]>;
  /** A driver that renders stories in `page` (03 §5). Call before the page navigates. */
  openDriver(page: Page, options?: DriverOptions): Promise<RenderDriver>;
  /** Stops the static server of a `static` source. Idempotent. */
  close(): Promise<void>;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

type Fatal = Err<readonly Diagnostic[]>;

function fatal(diag: Diagnostic): Fatal {
  return err([diag]);
}

const fatalContext = (data: Readonly<Record<string, unknown>>) => ({
  severity: 'fatal' as const,
  data: { fatal: true, ...data },
});

function indexUnreachable(url: string, data: Readonly<Record<string, unknown>>): Fatal {
  return fatal(createDiagnostic(diagnostic('SB_INDEX_UNREACHABLE'), { url }, { value: url, ...fatalContext(data) }));
}

/**
 * Classifies an `index.json` response that is not a usable index (03 §9.2, §9.4): a host check
 * (`SB_HOST_NOT_ALLOWED`), an auth failure (`SB_AUTH_FAILED`) or a redirect to a login page
 * (`SB_AUTH_REDIRECT`). `undefined` means "try `stories.json` next".
 */
function accessError(url: string, outcome: FetchOutcome): Fatal | undefined {
  if (outcome.kind !== 'response') return undefined;
  const { status, contentType, redirected, body } = outcome;
  const host = new URL(url).host;
  if ((status === 403 || status === 400) && /invalid host|allowedhosts/i.test(body)) {
    return fatal(
      createDiagnostic(diagnostic('SB_HOST_NOT_ALLOWED'), undefined, { value: host, ...fatalContext({ url, status }) }),
    );
  }
  if (status === 401 || status === 403) {
    return fatal(
      createDiagnostic(diagnostic('SB_AUTH_FAILED'), undefined, { value: url, ...fatalContext({ status }) }),
    );
  }
  if (status === 200 && redirected && /text\/html/i.test(contentType)) {
    return fatal(createDiagnostic(diagnostic('SB_AUTH_REDIRECT'), undefined, { value: url, ...fatalContext({}) }));
  }
  return undefined;
}

/** Reads the index (03 §2.1 steps 1–2): `index.json`, else a v3 `stories.json`. */
async function loadIndex(baseUrl: string, timeoutMs: number): Promise<Result<ParsedIndex, readonly Diagnostic[]>> {
  const indexUrl = new URL('index.json', baseUrl).href;
  const indexOutcome = await fetchText(indexUrl, timeoutMs);
  const access = accessError(indexUrl, indexOutcome);
  if (access) return access;
  let indexProblem = describeOutcome(indexOutcome);
  if (indexOutcome.kind === 'response' && indexOutcome.status === 200) {
    const parsed = parseStoryIndex(parseJsonBody(indexOutcome.body));
    if (parsed.ok) return parsed;
    indexProblem = parsed.error;
  }

  const storiesUrl = new URL('stories.json', baseUrl).href;
  const storiesOutcome = await fetchText(storiesUrl, timeoutMs);
  let storiesProblem = describeOutcome(storiesOutcome);
  if (storiesOutcome.kind === 'response' && storiesOutcome.status === 200) {
    const parsed = parseStoriesJsonV3(parseJsonBody(storiesOutcome.body));
    if (parsed.ok) return parsed;
    storiesProblem = parsed.error;
  }
  return indexUnreachable(indexUrl, { indexJson: indexProblem, storiesJson: storiesProblem });
}

interface Endpoint {
  readonly baseUrl: string;
  readonly defaultStoryId?: string;
  readonly server?: StaticServer;
}

async function openEndpoint(source: StorybookSource): Promise<Result<Endpoint, readonly Diagnostic[]>> {
  if (source.kind === 'url') {
    try {
      return ok(normalizeStorybookUrl(source.url));
    } catch (error) {
      return indexUnreachable(source.url, { reason: (error as Error).message });
    }
  }
  const dir = resolve(source.dir);
  const isDir = await stat(dir).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
  if (!isDir) return indexUnreachable(dir, { reason: 'the static build directory does not exist', dir });
  const server = await startStaticServer(dir);
  return ok({ baseUrl: server.url, server });
}

/**
 * Connects to a Storybook (03 §2–3): serves a static build on a loopback port or normalizes a
 * URL, reads `index.json` (or a v3 `stories.json`), `project.json` and checks `iframe.html`,
 * then filters the stories. Fatal problems come back as an `Err` with one `fatal` diagnostic:
 * `SB_INDEX_UNREACHABLE`, `SB_VERSION_UNSUPPORTED`, `SB_IFRAME_UNREACHABLE`,
 * `SB_HOST_NOT_ALLOWED`, `SB_AUTH_FAILED` or `SB_AUTH_REDIRECT`.
 */
export async function connectStorybook(
  options: ConnectOptions,
): Promise<Result<ConnectedStorybook, readonly Diagnostic[]>> {
  const source = typeof options.source === 'string' ? parseSource(options.source) : options.source;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const endpoint = await openEndpoint(source);
  if (!endpoint.ok) return endpoint;
  const connected = await discover(endpoint.value, options.filter ?? {}, timeoutMs);
  if (!connected.ok) await endpoint.value.server?.close();
  return connected;
}

async function discover(
  endpoint: Endpoint,
  filter: StoryFilter,
  timeoutMs: number,
): Promise<Result<ConnectedStorybook, readonly Diagnostic[]>> {
  const { baseUrl, server } = endpoint;
  const index = await loadIndex(baseUrl, timeoutMs);
  if (!index.ok) return index;

  // project.json is optional: dev servers and other hosts may not serve it (03 §2.1 step 3).
  const projectOutcome = await fetchText(new URL('project.json', baseUrl).href, timeoutMs);
  const project =
    projectOutcome.kind === 'response' && projectOutcome.status === 200
      ? parseProjectJson(parseJsonBody(projectOutcome.body))
      : {};
  const caps = detectCapabilities(index.value.format, project);
  const version = checkStorybookVersion(caps);
  if (version.fatal) {
    const skipped = index.value.entries.map((entry) => entry.story.id);
    return err([{ ...version.fatal, data: { ...version.fatal.data, skippedStories: skipped } }]);
  }

  const iframeUrl = new URL('iframe.html', baseUrl).href;
  const iframe = await fetchText(iframeUrl, timeoutMs);
  if (iframe.kind !== 'response' || iframe.status !== 200) {
    return fatal(
      createDiagnostic(diagnostic('SB_IFRAME_UNREACHABLE'), undefined, {
        value: iframeUrl,
        ...fatalContext({ url: iframeUrl, reason: describeOutcome(iframe) }),
      }),
    );
  }

  const { kept, excluded } = filterStories(index.value.entries, filter);
  const stories = kept.map((entry) => entry.story);
  const model: StorybookModel = {
    baseUrl,
    caps,
    stories,
    excluded,
    indexHash: sha256Hex(canonicalJSON(Object.fromEntries(kept.map((entry) => [entry.story.id, entry.raw])))),
    ...(endpoint.defaultStoryId === undefined ? {} : { defaultStoryId: endpoint.defaultStoryId }),
  };
  const storyIds: ReadonlySet<string> = new Set(index.value.entries.map((entry) => entry.story.id));

  return ok({
    baseUrl,
    caps,
    model,
    diagnostics: version.warnings,
    listStories: async () => stories,
    openDriver: (page, driverOptions) => createUrlDriver({ page, baseUrl, caps, storyIds }, driverOptions),
    close: async () => {
      await server?.close();
    },
  });
}
