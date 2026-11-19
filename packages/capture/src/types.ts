import type { CaptureDoc, JsonValue } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import type { ConnectedStorybook, DriverMode } from '@holotype/storybook';
import type { LaunchOptions, Page } from 'playwright';
import type { CaptureConfig } from './environment';

export interface CapturerOptions {
  /**
   * The Storybook to render from (`connectStorybook`). The capturer does not close it. Its
   * `origin` names it in `target.storybookUrl`, so captures of a static build hash the same
   * whatever loopback port served it.
   */
  readonly storybook: Pick<ConnectedStorybook, 'openDriver' | 'origin'>;
  /** The `capture` config namespace (16 §7). `svg`, `rasterize` and `devSourcemap` are not used yet. */
  readonly config?: CaptureConfig;
  /** `--concurrency`: overrides `config.workers`. */
  readonly workers?: number | 'auto';
  /** A Chromium binary (`--chromium-path`). Default: Playwright's pinned `chromium` channel. */
  readonly chromiumPath?: string;
  /** Extra launch options; `args` are appended to the capture flags (05 §1.3). */
  readonly launch?: LaunchOptions;
  /** `T.render` of the driver (03 §5.3). */
  readonly renderTimeoutMs?: number;
  /**
   * How pages render (03 §5): `channel` (default) drives one long-lived `iframe.html` page per
   * worker through the Storybook channel, falling back to the URL path when the preview has no
   * channel API; `url` navigates once per variant (`--no-channel`).
   */
  readonly renderMode?: DriverMode;
  /** Recycle a worker's page after this many variants. Default 500 (05 §1.1). */
  readonly recycleAfter?: number;
  /** Called for every new page before it renders: request routing, auth headers (03 §9.4). */
  readonly preparePage?: (page: Page) => void | Promise<void>;
}

/** One variant to capture (a `PlannedRender` plus its identity, 04 §1). */
export interface CaptureRequest {
  readonly storyId: string;
  /** Component id; default: the story-id prefix. Variants of one component share a worker. */
  readonly sid?: string;
  /** Variant key from the plan; default: computed from the request (06 §6). */
  readonly vk?: string;
  /** Arg values as applied over the story's own args. */
  readonly args?: Readonly<Record<string, JsonValue>>;
  readonly globals?: Readonly<Record<string, JsonValue>>;
  /** Default: the environment viewport (1280×800). */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** `parameters.holotype.rootSelector` (03 §6.1). */
  readonly rootSelector?: string;
  /** `parameters.holotype.keepLayout` (03 §6.1). */
  readonly keepLayout?: boolean;
  /** `parameters.holotype.unwrap` (03 §6.2): decorator wrappers to see through. Default all. */
  readonly unwrap?: boolean | number;
  /** `parameters.holotype.exclude`: CSS selectors left out of the capture. */
  readonly exclude?: readonly string[];
  /** Take the root screenshot @DPR (fidelity harness, 12). Default `true`. */
  readonly screenshot?: boolean;
}

/** A captured variant. */
export interface CaptureSuccess {
  readonly ok: true;
  readonly storyId: string;
  /** The document as its canonical JSON parses back: numbers rounded, keys sorted (06 §5). */
  readonly doc: CaptureDoc;
  /** `canonicalCapture(doc)`, the bytes the cache stores. */
  readonly canonical: string;
  /** `captureHash(doc)`: 16 hex, equal for equal captures (timing excluded, 05 §10.1). */
  readonly hash: string;
  /** Asset bytes by sha256 (`doc.assets` keys): the screenshot for now. */
  readonly assets: ReadonlyMap<string, Uint8Array>;
  /** Run-level diagnostics that are not facts of the capture: console errors, crash retries. */
  readonly warnings: readonly Diagnostic[];
}

/** A variant that could not be captured. The run goes on (03 §5.3). */
export interface CaptureFailure {
  readonly ok: false;
  readonly storyId: string;
  /** `SB_*` from the render, or `CAP_SERIALIZE_FAILED`. */
  readonly diagnostic: Diagnostic;
  readonly warnings: readonly Diagnostic[];
}

export type CaptureOutcome = CaptureSuccess | CaptureFailure;

export interface Capturer {
  /** Number of workers (browser contexts) the pool runs. */
  readonly workers: number;
  /** Captures one variant. Calls may overlap; they are spread across the workers. */
  capture(request: CaptureRequest): Promise<CaptureOutcome>;
  /** Waits for queued captures, then closes the browser. Idempotent. */
  close(): Promise<void>;
}
