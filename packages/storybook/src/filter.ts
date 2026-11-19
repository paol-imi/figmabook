import type { ParsedStoryEntry } from './index-json';
import type { ExcludedStory, ExclusionReason, IndexStory, StoryFilter } from './types';

/** The opt-in tag (README §7). `!figma` opts out and wins over everything else. */
export const FIGMA_TAG = 'figma';
export const FIGMA_OPT_OUT_TAG = '!figma';

/**
 * Compiles a story glob (16 §5): `**` matches anything, `*` anything but `/`, `?` one character
 * but `/`. A `**` segment followed by a slash also matches no segment. Every other character is
 * literal; matching is case-sensitive and covers the whole string.
 */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] ?? '';
    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** Whether any glob matches the story's title path or its id (16 §5). */
function matchesAny(story: IndexStory, globs: readonly RegExp[]): boolean {
  return globs.some((glob) => glob.test(story.title) || glob.test(story.id));
}

export interface FilterResult {
  readonly kept: readonly ParsedStoryEntry[];
  readonly excluded: readonly ExcludedStory[];
}

/**
 * Applies the story filter (03 §2.2, README §7, 16 §4–§5), in precedence order:
 *
 * 1. `subtype: 'test'` entries are never captured.
 * 2. Tags. A `!figma` tag opts out. Storybook applies `!tag` entries while it builds the index,
 *    so an opted-out story usually just lacks `figma`: when any story of the index carries
 *    `figma` (the project opts in by tag), a story without it is opted out. With
 *    `requireTag`, a story without `figma` is dropped even when no story carries it.
 * 3. `exclude` globs, which win over `include` globs (default `['**']`).
 */
export function filterStories(entries: readonly ParsedStoryEntry[], filter: StoryFilter = {}): FilterResult {
  const include = (filter.include ?? ['**']).map(globToRegExp);
  const exclude = (filter.exclude ?? []).map(globToRegExp);
  const projectUsesTag = entries.some((entry) => entry.story.tags.includes(FIGMA_TAG));

  const reasonFor = ({ story, isTest }: ParsedStoryEntry): ExclusionReason | undefined => {
    if (isTest) return 'test-entry';
    if (story.tags.includes(FIGMA_OPT_OUT_TAG)) return 'tag-opt-out';
    if (!story.tags.includes(FIGMA_TAG)) {
      if (filter.requireTag === true) return 'tag-required';
      if (projectUsesTag) return 'tag-opt-out';
    }
    if (matchesAny(story, exclude)) return 'excluded';
    if (!matchesAny(story, include)) return 'not-included';
    return undefined;
  };

  const kept: ParsedStoryEntry[] = [];
  const excluded: ExcludedStory[] = [];
  for (const entry of entries) {
    const reason = reasonFor(entry);
    if (reason === undefined) kept.push(entry);
    else excluded.push({ id: entry.story.id, title: entry.story.title, reason });
  }
  return { kept, excluded };
}
