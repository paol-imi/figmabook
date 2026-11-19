import { err, ok, type Result } from '@holotype/shared';
import type { DesignChangeRequest } from './dcr';
import type { DcrAnswers } from './sidecar';

/*
 * Requests on one branch (D-56): each is cumulative (everything vs the baseline) and
 * records its predecessor in `header.parent`; `.holotype/requests/LATEST-<branch-slug>`
 * names the newest. Pure helpers: reading and writing the files is the CLI's job.
 */

/** Where requests live in a repository (15 §6 "On disk"). */
export const REQUESTS_DIR = '.holotype/requests';

/**
 * A file-name-safe form of a git branch name: `/` becomes `-`, any character outside
 * `[A-Za-z0-9._-]` becomes `_`, and leading dots are dropped. `feat/price-tag` →
 * `feat-price-tag`. Two branches can share a slug (`feat/a`, `feat-a`); `resolveChain`
 * checks `header.branch`, so a pointer never resolves to another branch's request.
 */
export function branchSlug(branch: string): string {
  const slug = branch
    .replace(/\//g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '');
  if (slug.length === 0) throw new RangeError(`Branch name "${branch}" has no file-name-safe characters.`);
  return slug;
}

/** `LATEST-<branch-slug>`: the file in {@link REQUESTS_DIR} holding the newest request id. */
export function latestPointerName(branch: string): string {
  return `LATEST-${branchSlug(branch)}`;
}

/** The parts of a request the chain needs. */
export type ChainLink = Pick<DesignChangeRequest, 'id'> & {
  readonly header: Pick<DesignChangeRequest['header'], 'branch' | 'parent'>;
};

export interface RequestChain<T extends ChainLink> {
  /** Oldest first; the last one is the newest. */
  readonly chain: readonly T[];
  readonly latest: T;
}

/**
 * Orders the requests of one branch by their `parent` links. A parent that is not among
 * them (pruned with `dcr prune --keep latest`) starts the chain. Fails on an empty list, a
 * request of another branch, a duplicated id, a fork (two requests with the same parent,
 * or several chains) or a cycle.
 */
export function resolveChain<T extends ChainLink>(
  requests: readonly T[],
  branch: string,
): Result<RequestChain<T>, string> {
  if (requests.length === 0) return err(`No request found for branch "${branch}".`);
  const byId = new Map<string, T>();
  for (const request of requests) {
    if (request.header.branch !== branch) {
      return err(`Request ${request.id} belongs to branch "${request.header.branch}", not "${branch}".`);
    }
    if (byId.has(request.id)) return err(`Request ${request.id} appears twice.`);
    byId.set(request.id, request);
  }
  const childOf = new Map<string, T>();
  const roots: T[] = [];
  for (const request of requests) {
    const parent = request.header.parent;
    if (parent === undefined || !byId.has(parent)) {
      roots.push(request);
      continue;
    }
    const sibling = childOf.get(parent);
    if (sibling) return err(`Requests ${sibling.id} and ${request.id} both follow ${parent}: the chain forks.`);
    childOf.set(parent, request);
  }
  if (roots.length === 0) return err(`The requests of branch "${branch}" form a cycle.`);
  if (roots.length > 1) {
    const ids = roots.map((root) => root.id).sort();
    return err(`Branch "${branch}" has ${roots.length} separate request chains (starting at ${ids.join(', ')}).`);
  }
  const chain: T[] = [];
  for (let at: T | undefined = roots[0]; at !== undefined; at = childOf.get(at.id)) chain.push(at);
  if (chain.length !== requests.length) return err(`The requests of branch "${branch}" form a cycle.`);
  return ok({ chain, latest: chain[chain.length - 1] as T });
}

export type BoundAnswers =
  | {
      /** The answers were given for this exact `dcrHash`. */
      readonly state: 'current';
      /** Answers to questions of this request, by question id. */
      readonly byQuestion: Readonly<Record<string, string>>;
      /** Answered question ids this request does not ask, sorted. */
      readonly unknownQuestions: readonly string[];
    }
  | {
      /** Given for another `dcrHash`: the request changed since; the reviewer answers again. */
      readonly state: 'stale';
      readonly answeredHash: string;
    };

/**
 * Binds reviewer answers to a request (D-56). Like approval (D-44), answers hold only for
 * the `dcrHash` they were given for; they are never part of the request or its hash.
 */
export function bindAnswers(
  dcr: Pick<DesignChangeRequest, 'dcrHash' | 'questions'>,
  answers: DcrAnswers,
): BoundAnswers {
  if (answers.dcrHash !== dcr.dcrHash) return { state: 'stale', answeredHash: answers.dcrHash };
  const asked = new Set(dcr.questions.map((question) => question.id));
  const byQuestion: Record<string, string> = {};
  const unknownQuestions: string[] = [];
  for (const id of Object.keys(answers.byQuestion).sort()) {
    const answer = answers.byQuestion[id] as string;
    // A data property even for an id like `__proto__`.
    if (asked.has(id)) Object.defineProperty(byQuestion, id, { value: answer, enumerable: true, writable: true });
    else unknownQuestions.push(id);
  }
  return { state: 'current', byQuestion, unknownQuestions };
}
