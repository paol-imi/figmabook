/// <reference lib="dom" />
import type { Diagnostic, DiagnosticCode } from '@holotype/shared';
import type { ElementHandle } from 'playwright';

/**
 * Where a Storybook lives (03 §2.1): a static build that Holotype serves on a loopback port
 * (03 §9.1), or a running server (dev server, Chromatic permalink, any host).
 * Authenticated hosts (03 §9.4) are not supported yet.
 */
export type StorybookSource =
  | { readonly kind: 'static'; readonly dir: string }
  | { readonly kind: 'url'; readonly url: string };

/** Format of the story index that was read (03 §2.2). */
export type IndexFormat = 'v3' | 'v4' | 'v5';

/** What the connected Storybook can do (03 §3.2). Flags, not version branches, drive behaviour. */
export interface SbCapabilities {
  /** Semver of Storybook core from `project.json`; `null` when the host does not serve it. */
  readonly version: string | null;
  readonly indexFormat: IndexFormat;
  /** `storyFinished` is emitted after `afterEach` (8.3+); otherwise `storyRendered` is the done event. */
  readonly storyFinishedEvent: boolean;
  /** The `completing` phase waits for animations (9.0+). */
  readonly awaitsAnimations: boolean;
  /** The test-runner user agent pauses CSS animations instead of waiting (9.1+). */
  readonly pauseAnimationsInTestRunner: boolean;
  /** Storybook 11 docgen service. */
  readonly docgenServer: boolean;
  /** `manifests/components.json` may be present (10.1+). */
  readonly componentsManifest: boolean;
  /** `argtypesInfoRequest` / `argtypesInfoResponse` (10.0+). */
  readonly argTypesInfoEvent: boolean;
  /** Story-level `globals` (8.3+). */
  readonly storyGlobals: boolean;
  /** The pseudo-states addon syncs a `pseudo` global (9.0+). */
  readonly pseudoStatesGlobal: boolean;
  /** Framework package, e.g. `@storybook/react-vite`. */
  readonly framework?: string;
  /** Renderer package, e.g. `@storybook/react`. */
  readonly renderer?: string;
  /** `vite`, `webpack5`, or the builder package name when it is neither. */
  readonly builder?: string;
}

/** One story of the index, normalized (03 §2.2, §4.4). Docs entries never appear. */
export interface IndexStory {
  /** Storybook story id, e.g. `components-button--primary`. */
  readonly id: string;
  /** Component id: the story-id prefix before `--` (README §7). */
  readonly sid: string;
  readonly title: string;
  /** `title.split('/')`. */
  readonly titlePath: readonly string[];
  readonly name: string;
  readonly importPath: string;
  /** Tags as Storybook resolved them (`!tag` entries already applied). `[]` on index v4 without tags. */
  readonly tags: readonly string[];
  readonly exportName?: string;
  readonly componentPath?: string;
}

/** Why a story of the index is not captured (03 §2.2, README §7, 16 §5). */
export type ExclusionReason =
  /** A `subtype: 'test'` entry: a test, not a story. */
  | 'test-entry'
  /** Tagged `!figma`, or untagged in a project that opts stories in with `figma`. */
  | 'tag-opt-out'
  /** Not tagged `figma` while `storybook.requireTag` is set. */
  | 'tag-required'
  /** Matches no `include` glob. */
  | 'not-included'
  /** Matches an `exclude` glob. */
  | 'excluded';

export interface ExcludedStory {
  readonly id: string;
  readonly title: string;
  readonly reason: ExclusionReason;
}

/** Story filters from config: `storybook.requireTag`, top-level `include` / `exclude` (16 §4–§5). */
export interface StoryFilter {
  /** Only stories tagged `figma`. Default `false`. */
  readonly requireTag?: boolean;
  /** Globs on the title path and the story id. Default `['**']`. */
  readonly include?: readonly string[];
  /** Globs on the title path and the story id; wins over `include`. Default `[]`. */
  readonly exclude?: readonly string[];
}

/** What discovery knows about a Storybook (02 §6.1): its capabilities and its stories. */
export interface StorybookModel {
  /** Root URL with a trailing slash; `iframe.html` and `index.json` resolve against it. */
  readonly baseUrl: string;
  readonly caps: SbCapabilities;
  /** The filtered stories, in index order. */
  readonly stories: readonly IndexStory[];
  /** Stories of the index that the filter dropped, in index order. */
  readonly excluded: readonly ExcludedStory[];
  /** `sha256(canonicalJSON(filtered index entries))`, 64 hex characters (03 §2.2). */
  readonly indexHash: string;
  /** The story of a `?path=/story/<id>` deep link in the source URL. */
  readonly defaultStoryId?: string;
}

/** One render (03 §5.1). */
export interface RenderRequest {
  readonly storyId: string;
  /**
   * Arg values, applied over the story's `initialArgs` (the full desired set, 03 §5.1); pass
   * `undefined` for a key to unset it. The channel path also takes live values and markers:
   * `{ $fromStory: storyId, arg }` is that story's `initialArgs[arg]` (a React node, say), and
   * `{ $mapKey: key }` is `argTypes[name].mapping[key]` (03 §5.3 "In-page values").
   */
  readonly args?: Readonly<Record<string, unknown>>;
  /** Global values, applied over `initialGlobals`; globals left out go back to their initial value. */
  readonly globals?: Readonly<Record<string, unknown>>;
  /** Unmounts and mounts the story again for fresh component state (03 §5.1). Ignored on the URL path. */
  readonly remount?: boolean;
  /** Page viewport for this render. Kept for later renders until changed. */
  readonly viewport?: { readonly width: number; readonly height: number };
  /**
   * `parameters.holotype.rootSelector` (03 §6.1): a CSS selector evaluated on the document; `>>>`
   * steps into an open shadow root (`host >>> inner`). Default `#storybook-root`, then `#root`.
   */
  readonly rootSelector?: string;
  /** `parameters.holotype.keepLayout` (03 §6.1): keep Storybook's `padded` / `centered` layout. */
  readonly keepLayout?: boolean;
  /**
   * `parameters.holotype.unwrap` (03 §6.2): `false` keeps decorator wrappers in the root handles,
   * a number caps how many are unwrapped. Default `true` (all transparent wrappers).
   */
  readonly unwrap?: boolean | number;
  /**
   * Runs the stability check (03 §5.5 step 8) for this render. Default: on for the first render
   * of each component on the driver, per {@link DriverOptions.stability}.
   */
  readonly checkStability?: boolean;
}

/** Which Storybook event ended the render (03 §5.2). */
export type RenderPhase = 'finished' | 'rendered';

/** How a render reached the page: the warm channel loop, a fresh document, or one URL navigation. */
export type RenderPath = 'channel' | 'boot' | 'url';

export interface RenderResult {
  readonly ok: true;
  readonly storyId: string;
  /** The `iframe.html` URL that was rendered. */
  readonly url: string;
  readonly renderMs: number;
  readonly phase: RenderPhase;
  /** How the render reached the page (set by the drivers of this package). */
  readonly via?: RenderPath;
  /** Render attempts, the retry on a fresh document included (02 §1.3). Default 1. */
  readonly attempts?: number;
  /** The root container (`#storybook-root`, or the `rootSelector` match). */
  readonly container: ElementHandle<Element>;
  /**
   * What the story rendered (03 §6): the container's displayed element children, with transparent
   * decorator wrappers unwrapped (03 §6.2). Several handles mean a fragment.
   */
  readonly rootHandles: readonly ElementHandle<Element>[];
  /** Portals outside the container (03 §6.3). Always empty in this version. */
  readonly portalHandles: readonly ElementHandle<Element>[];
  /** Non-fatal diagnostics of this render, such as `SB_CONSOLE_ERROR`. */
  readonly warnings: readonly Diagnostic[];
}

/** Codes a render, or the metadata of a story (`describe`), can fail with. */
export type SbErrorCode = Extract<
  DiagnosticCode,
  | 'SB_STORY_ERROR'
  | 'SB_PLAY_ERROR'
  | 'SB_STORY_MISSING'
  | 'SB_STORY_LOAD_FAILED'
  | 'SB_METADATA_TIMEOUT'
  | 'SB_RENDER_TIMEOUT'
  | 'SB_STORY_UNRENDERABLE'
  | 'SB_PREVIEW_INIT_TIMEOUT'
  | 'SB_IFRAME_UNREACHABLE'
  | 'SB_ROOT_NOT_FOUND'
  | 'SB_URL_ARG_UNENCODABLE'
>;

/** A failed render: the variant is not produced (03 §5.3). */
export interface SbError {
  readonly ok: false;
  readonly storyId: string;
  readonly code: SbErrorCode;
  /** The error itself; `data` carries the Storybook message, stack and event where known. */
  readonly diagnostic: Diagnostic;
  readonly warnings: readonly Diagnostic[];
  /** How the failed attempt reached the page, when it did. */
  readonly via?: RenderPath;
  /** Render attempts, the retry on a fresh document included (02 §1.3). Default 1. */
  readonly attempts?: number;
}

/** How a driver renders: the channel loop on one long-lived page (03 §5.3), or one navigation per render (03 §5.4). */
export type DriverMode = 'channel' | 'url';

/** Renders story states in one Playwright page (03 §5). */
export interface RenderDriver {
  /**
   * `channel`: one `iframe.html` page driven through the Storybook channel (03 §5.3). `url`: one
   * navigation per render (03 §5.4), asked for or fallen back to when the preview API is missing.
   */
  readonly mode: DriverMode;
  /** Renders and settles one story state. Calls on one driver must not overlap. */
  render(request: RenderRequest): Promise<RenderResult | SbError>;
  /** Hard reset: leaves the preview so the next render starts from a fresh document. */
  reload(): Promise<void>;
  /**
   * Stops using the page, bounded in time: waits for a render still in flight and checks the page
   * answers. The page belongs to the caller and stays open, unless it stopped answering: then it
   * is closed (its context if need be) so the caller's own `page.close()` cannot hang, and the
   * report says why. Idempotent.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: drivers that predate the report resolve with nothing.
  dispose(): Promise<DisposeReport | void>;
}

/** What {@link RenderDriver.dispose} had to do. */
export interface DisposeReport {
  /**
   * `none`: the page answered and stays open. `page` / `context`: it did not answer within
   * `disposeTimeoutMs`, and was closed (its browser context too, for `context`). `stuck`: even
   * closing the context did not return in time.
   */
  readonly forced: 'none' | 'page' | 'context' | 'stuck';
  /** Why the page was closed. */
  readonly reason?: string;
}

/** When the driver runs the stability check (03 §5.5 step 8). */
export type StabilityMode = 'first-per-component' | 'always' | 'never';

export interface DriverOptions {
  /** `T.render` (03 §5.3): every step of one render attempt together. Default 15 000 ms. */
  readonly renderTimeoutMs?: number;
  /** `url` forces the URL path (`--no-channel`). Default `channel`, with the URL path as fallback. */
  readonly mode?: DriverMode;
  /** Default `first-per-component`. */
  readonly stability?: StabilityMode;
  /** Bound of each `dispose()` step (03 §5.1). Default 5 000 ms. */
  readonly disposeTimeoutMs?: number;
}
