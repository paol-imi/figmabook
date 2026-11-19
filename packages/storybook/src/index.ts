import { NotImplementedError } from '@holotype/shared';

/** One story entry from `index.json` (index v5). */
export interface StoryEntry {
  /** Storybook story id, e.g. `components-button--primary`. */
  readonly id: string;
  /** Component id: the story-id prefix before `--`. */
  readonly sid: string;
  readonly title: string;
  readonly name: string;
  readonly tags: readonly string[];
}

/** What discovery knows about a Storybook: version, renderer and its stories. */
export interface StorybookModel {
  readonly url: string;
  readonly version: string;
  readonly renderer?: string;
  readonly stories: readonly StoryEntry[];
}

/** Renders one story state in the preview iframe and resolves once it is settled. */
export interface RenderDriver {
  render(request: {
    readonly storyId: string;
    readonly args?: Readonly<Record<string, unknown>>;
    readonly globals?: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

/** A connected Storybook: a static build directory or a running dev server. */
export interface StorybookSource {
  readonly model: StorybookModel;
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** Storybook URL or the path of a static build (`storybook-static/`). */
  readonly url: string;
}

/** Discovers a Storybook's index, metadata, docgen and globals (03). */
export async function connectStorybook(_options: ConnectOptions): Promise<StorybookSource> {
  throw new NotImplementedError('connectStorybook', 'Phase 1');
}

/**
 * The component id (`sid`) of a story: the story-id prefix before `--`, e.g.
 * `components-button--primary` → `components-button` (README §7).
 */
export function componentIdFromStoryId(storyId: string): string {
  const separator = storyId.indexOf('--');
  if (separator <= 0) throw new TypeError(`Not a Storybook story id: "${storyId}".`);
  return storyId.slice(0, separator);
}
