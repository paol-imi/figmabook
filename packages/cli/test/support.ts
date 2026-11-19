import { readFileSync } from 'node:fs';
import type { CaptureOutcome, CaptureRequest, Capturer } from '@holotype/capture';
import { type CaptureDoc, canonicalJSON, captureNumKind, sha256Hex, validateCaptureDoc } from '@holotype/ir';
import { DEFAULT_MAPPER_SETTINGS, mapComponent } from '@holotype/mapper';
import { planSingleStory } from '@holotype/planner';
import { type Diagnostic, ok, type Result } from '@holotype/shared';
import type { ConnectedStorybook, IndexStory, SbCapabilities, StorybookModel } from '@holotype/storybook';
import type { BundleInput, CaptureDeps, CliIo } from '../src';
import { metaInput } from '../src';

/** Story ids with a recorded capture in `packages/capture/test/e2e/__golden__/`. */
export const GOLDEN_STORIES = ['micro-flex--row', 'components-badge--default'] as const;

/** A real capture of the fixture Storybook, recorded by the capture e2e suite. */
export function goldenCapture(storyId: string): CaptureDoc {
  const url = new URL(`../../capture/test/e2e/__golden__/${storyId}.capture.json`, import.meta.url);
  const result = validateCaptureDoc(JSON.parse(readFileSync(url, 'utf8')));
  if (!result.ok) throw new Error(`golden ${storyId} is not a valid CaptureDoc`);
  return result.value;
}

export const CAPS: SbCapabilities = {
  version: '10.6.7',
  indexFormat: 'v5',
  storyFinishedEvent: true,
  awaitsAnimations: true,
  pauseAnimationsInTestRunner: true,
  docgenServer: false,
  componentsManifest: true,
  argTypesInfoEvent: true,
  storyGlobals: true,
  pseudoStatesGlobal: true,
  framework: '@storybook/react-vite',
  renderer: '@storybook/react',
  builder: 'vite',
};

const STORIES: Record<string, IndexStory> = {
  'micro-flex--row': {
    id: 'micro-flex--row',
    sid: 'micro-flex',
    title: 'Micro/Flex',
    titlePath: ['Micro', 'Flex'],
    name: 'Row',
    importPath: './src/micro/Flex.stories.tsx',
    tags: ['dev', 'test'],
  },
  'components-badge--default': {
    id: 'components-badge--default',
    sid: 'components-badge',
    title: 'Components/Badge',
    titlePath: ['Components', 'Badge'],
    name: 'Default',
    importPath: './src/components/Badge/Badge.stories.tsx',
    componentPath: './src/components/Badge/Badge.tsx',
    tags: ['dev', 'test'],
  },
};

export const MODEL: StorybookModel = {
  baseUrl: 'http://127.0.0.1:6006/',
  caps: CAPS,
  stories: Object.values(STORIES),
  excluded: [],
  indexHash: 'b'.repeat(64),
};

/** A 1×1 PNG. */
export const PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
);
export const PNG_SHA = sha256Hex(PNG);

/** A connected Storybook over {@link MODEL}, without a server. */
export function fakeStorybook(closed: string[] = []): ConnectedStorybook {
  return {
    baseUrl: MODEL.baseUrl,
    origin: 'static:storybook-static',
    caps: CAPS,
    model: MODEL,
    diagnostics: [],
    listStories: async () => MODEL.stories,
    openDriver: async () => {
      throw new Error('the fake Storybook renders nothing');
    },
    describe: async () => {
      throw new Error('the fake Storybook describes nothing');
    },
    close: async () => {
      closed.push('storybook');
    },
  };
}

export interface FakeCapturerOptions {
  /** Story ids whose capture fails with `SB_STORY_ERROR`. */
  readonly failing?: readonly string[];
  /** Make `capture()` throw, as a browser that cannot start does. */
  readonly throws?: Error;
  readonly closed?: string[];
}

/** A capturer that answers with the golden captures, re-keyed to the request's `vk`. */
export function fakeCapturer(options: FakeCapturerOptions = {}): Capturer {
  return {
    workers: 1,
    capture: async (request: CaptureRequest): Promise<CaptureOutcome> => {
      if (options.throws) throw options.throws;
      if (options.failing?.includes(request.storyId)) {
        const diagnostic: Diagnostic = {
          code: 'SB_STORY_ERROR',
          severity: 'error',
          message: 'The story threw while rendering.',
          value: request.storyId,
        };
        return { ok: false, storyId: request.storyId, diagnostic, warnings: [] };
      }
      const golden = goldenCapture(request.storyId);
      const doc: CaptureDoc = {
        ...golden,
        target: {
          ...golden.target,
          vk: request.vk ?? golden.target.vk,
          // What the capturer records for a static build (`ConnectedStorybook.origin`).
          storybookUrl: 'static:storybook-static/iframe.html',
        },
      };
      const canonical = canonicalJSON(doc, { numKind: captureNumKind });
      return {
        ok: true,
        storyId: request.storyId,
        doc,
        canonical,
        hash: sha256Hex(canonical).slice(0, 16),
        assets: new Map(),
        warnings: [],
      };
    },
    close: async () => {
      options.closed?.push('capturer');
    },
  };
}

/** Capture deps over the fakes, with a fixed clock. */
export function fakeDeps(
  options: FakeCapturerOptions & { readonly connectError?: Diagnostic } = {},
): Partial<CaptureDeps> {
  let t = 0;
  return {
    connect: async (): Promise<Result<ConnectedStorybook, readonly Diagnostic[]>> =>
      options.connectError ? { ok: false, error: [options.connectError] } : ok(fakeStorybook(options.closed)),
    createCapturer: () => fakeCapturer(options),
    now: () => new Date('2026-11-19T10:00:00.000Z'),
    elapsed: () => (t += 5),
  };
}

/** An in-memory `CliIo`. */
export function memoryIo(cwd: string, env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env, cwd };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

/** The golden scenes, mapped the way the CLI maps them. */
export function goldenScene(storyId: string) {
  const plan = planSingleStory(MODEL, storyId);
  if (!plan.ok) throw new Error(plan.error.message);
  const story = STORIES[storyId];
  if (story === undefined) throw new Error(`no story ${storyId}`);
  const capture = goldenCapture(storyId);
  return mapComponent({
    sid: plan.value.sid,
    meta: metaInput(plan.value, story, []),
    plan: plan.value,
    captures: new Map([[capture.target.vk, capture]]),
    tokens: { tokens: null, byCssName: {} },
    components: new Map(),
    config: DEFAULT_MAPPER_SETTINGS,
  }).scene;
}

/** A bundle input over the golden scenes. */
export function bundleInput(patch: Partial<BundleInput> = {}): BundleInput {
  return {
    runId: '20261119T100000Z-0123abcd',
    createdAt: '2026-11-19T10:00:00Z',
    generator: {
      name: '@holotype/cli',
      version: '0.0.0',
      mapper: '0.0.0',
      capture: '0.0.0',
      chromium: '153.0.8010.12',
      playwright: '1.63.0',
    },
    source: {
      storybookVersion: '10.6.7',
      renderer: '@storybook/react',
      builder: 'vite',
      origin: 'static:storybook-static',
      fingerprint: 'b'.repeat(64),
    },
    configHash: '0123456789abcdef',
    components: GOLDEN_STORIES.map((id) => ({ scene: goldenScene(id), status: 'ok' as const })),
    assets: new Map(),
    report: {
      kind: 'holotype/report',
      summary: {
        components: 2,
        variants: 2,
        warnings: 0,
        errors: 0,
        autoLayoutCoverage: 0,
        propertyQuality: 1,
        rasterizedNodes: 0,
      },
      byCode: {},
      components: [],
    },
    ...patch,
  };
}
