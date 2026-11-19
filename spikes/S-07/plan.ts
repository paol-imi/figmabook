/**
 * The S-07 variant plan: a deterministic list of story states that exercises the render loop
 * the way the planner will (04): every story at its initial args, then single-arg changes,
 * then the dark theme, grouped by component as the capture pool runs them (05 §1.1). Pure.
 */

/** A JSON value (the shape of `@holotype/ir` `JsonValue`). */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** What the plan needs to know about a story (a subset of 03 §4.4 `StoryMeta`). */
export interface StoryMetaLite {
  readonly id: string;
  readonly title: string;
  /** JSON-safe initial args; values that are not JSON are `{ $nonJson: <typeof> }`. */
  readonly initialArgs: Readonly<Record<string, Json>>;
  readonly argTypes: Readonly<
    Record<string, { readonly options?: readonly Json[]; readonly control?: string | false }>
  >;
}

export interface Variant {
  /** Position in the plan, from 0. */
  readonly index: number;
  readonly storyId: string;
  /** Component id (the story-id prefix). */
  readonly sid: string;
  /** Args over the story's `initialArgs` (`RenderRequest.args`). */
  readonly args: Readonly<Record<string, Json>>;
  readonly globals: Readonly<Record<string, Json>>;
  /** `storyId` plus the changed args and globals, for tables. */
  readonly label: string;
}

export interface PlanOptions {
  /** Number of variants. Default 200. */
  readonly count?: number;
  /** A global to vary, e.g. `{ name: 'theme', value: 'dark' }`; none by default. */
  readonly themeGlobal?: { readonly name: string; readonly value: Json };
  /**
   * `grouped` (default): each story's variants back to back, as the capture pool runs them.
   * `interleaved`: round-robin over stories, the worst case where every variant switches story.
   */
  readonly order?: 'grouped' | 'interleaved';
}

/** Characters the URL path accepts in a string arg (03 §5.4), so both drivers can render it. */
const URL_SAFE_TEXT = /^[A-Za-z0-9 _-]*$/;

const isPrimitive = (value: Json | undefined): value is string | number | boolean | null =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

const sameJson = (a: Json | undefined, b: Json | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

interface Candidate {
  readonly args: Readonly<Record<string, Json>>;
  readonly globals: Readonly<Record<string, Json>>;
}

/** Single-change candidates of one story, in a fixed order: options, toggles, text, theme. */
export function storyCandidates(story: StoryMetaLite, options: PlanOptions = {}): Candidate[] {
  const out: Candidate[] = [{ args: {}, globals: {} }];
  const names = Object.keys(story.argTypes).sort();
  for (const name of names) {
    const argType = story.argTypes[name];
    if (argType === undefined || argType.control === false) continue;
    const initial = story.initialArgs[name];
    const choices = argType.options?.filter(isPrimitive) ?? [];
    if (choices.length > 0) {
      for (const choice of choices) if (!sameJson(choice, initial)) out.push({ args: { [name]: choice }, globals: {} });
    } else if (typeof initial === 'boolean') {
      out.push({ args: { [name]: !initial }, globals: {} });
    } else if (typeof initial === 'string' && (argType.control === undefined || argType.control === 'text')) {
      const text = `Spike ${name} text`;
      if (URL_SAFE_TEXT.test(text)) out.push({ args: { [name]: text }, globals: {} });
    }
  }
  const theme = options.themeGlobal;
  // The theme variant is the third one of a story when it has more, so themes appear early.
  if (theme !== undefined) out.splice(Math.min(2, out.length), 0, { args: {}, globals: { [theme.name]: theme.value } });
  return out;
}

const describe = (values: Readonly<Record<string, Json>>): string =>
  Object.entries(values)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');

/**
 * Builds the plan: round-robin over stories by candidate rank (every story's initial state
 * first, then each story's first change, …) until `count` variants are chosen, then ordered by
 * story (index order) and rank, so each component's variants run back to back.
 */
export function buildPlan(stories: readonly StoryMetaLite[], options: PlanOptions = {}): Variant[] {
  const count = options.count ?? 200;
  if (!Number.isInteger(count) || count <= 0)
    throw new RangeError(`Variant count must be a positive integer, got ${count}.`);
  const perStory = stories.map((story) => storyCandidates(story, options));
  const total = perStory.reduce((sum, list) => sum + list.length, 0);
  if (total < count) throw new RangeError(`The stories give only ${total} variants; ${count} were asked for.`);

  const chosen: { story: number; rank: number }[] = [];
  for (let rank = 0; chosen.length < count; rank += 1) {
    for (let story = 0; story < stories.length && chosen.length < count; story += 1) {
      if (rank < (perStory[story]?.length ?? 0)) chosen.push({ story, rank });
    }
  }
  if (options.order !== 'interleaved') chosen.sort((a, b) => a.story - b.story || a.rank - b.rank);
  return chosen.map(({ story, rank }, index) => {
    const meta = stories[story] as StoryMetaLite;
    const candidate = (perStory[story] as Candidate[])[rank] as Candidate;
    const changes = [describe(candidate.args), describe(candidate.globals)].filter((part) => part !== '').join(' ');
    return {
      index,
      storyId: meta.id,
      sid: meta.id.split('--')[0] ?? meta.id,
      args: candidate.args,
      globals: candidate.globals,
      label: changes === '' ? meta.id : `${meta.id} ${changes}`,
    };
  });
}

/** Every `step`-th variant, starting at `offset`: the capture-parity sample. */
export function sample<T>(items: readonly T[], step: number, offset = 0): T[] {
  if (!Number.isInteger(step) || step <= 0)
    throw new RangeError(`Sample step must be a positive integer, got ${step}.`);
  return items.filter((_, index) => index >= offset && (index - offset) % step === 0);
}

/**
 * Splits a plan into `pages` lanes by component, as the capture pool does (05 §1.1): every
 * variant of one `sid` runs on the same page, components are dealt out in order of first use.
 */
export function lanes<T extends { readonly sid: string }>(plan: readonly T[], pages: number): T[][] {
  if (!Number.isInteger(pages) || pages <= 0) throw new RangeError(`pages must be a positive integer, got ${pages}.`);
  const laneOf = new Map<string, number>();
  const out: T[][] = Array.from({ length: pages }, () => []);
  for (const variant of plan) {
    let lane = laneOf.get(variant.sid);
    if (lane === undefined) {
      lane = laneOf.size % pages;
      laneOf.set(variant.sid, lane);
    }
    out[lane]?.push(variant);
  }
  return out.filter((lane) => lane.length > 0);
}
