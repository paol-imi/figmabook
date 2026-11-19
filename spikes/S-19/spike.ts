/**
 * The S-19 measurement: capture stories with `@holotype/capture` (Playwright + CDP), find each
 * captured node in the live page, resolve the provenance of its mapped fields and check every
 * location against the repository files.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCapturer } from '@holotype/capture';
import type { Diagnostic } from '@holotype/shared';
import type { ConnectedStorybook } from '@holotype/storybook';
import type { FieldRecord } from './coverage.ts';
import { type ReadRepoFile, verifyField } from './oracle.ts';
import { ProvenanceProbe } from './probe.ts';
import { ProvenanceDiagnostics } from './resolver/diagnostics.ts';
import { relevantFields } from './resolver/fields.ts';
import { resolveNodeFields } from './resolver/resolve.ts';
import { SheetTable } from './resolver/sheets.ts';

export interface SpikeOptions {
  readonly storybook: ConnectedStorybook;
  readonly storyIds: readonly string[];
  /** The fixture's `theme` global (03 §8); each story is captured once per theme. Default `['light']`. */
  readonly themes?: readonly Theme[];
  /** Absolute repository root: locations are made relative to it and read from it. */
  readonly repoRoot: string;
  readonly chromiumPath?: string;
}

export type Theme = 'light' | 'dark';

export interface SpikeRun {
  readonly records: readonly FieldRecord[];
  readonly diagnostics: readonly Diagnostic[];
  /** Capture IR elements with no DOM match (should be empty). */
  readonly unmatched: readonly { readonly storyId: string; readonly nodeId: string }[];
  readonly captureFailures: readonly { readonly storyId: string; readonly code: string }[];
  readonly chromium: string;
  /** CDP cost (05 §6.2 cost control): calls and wall time of the matched and computed style reads. */
  readonly cost: { readonly matchedCalls: number; readonly matchedMs: number; readonly resolveMs: number };
}

/** Reads repo files once each. */
export function repoReader(repoRoot: string): ReadRepoFile {
  const cache = new Map<string, string | undefined>();
  return (path) => {
    if (!cache.has(path)) {
      try {
        cache.set(path, readFileSync(join(repoRoot, path), 'utf8'));
      } catch {
        cache.set(path, undefined);
      }
    }
    return cache.get(path);
  };
}

export async function runSpike(options: SpikeOptions): Promise<SpikeRun> {
  const read = repoReader(options.repoRoot);
  let probe: Promise<ProvenanceProbe> | undefined;
  const capturer = createCapturer({
    storybook: options.storybook,
    workers: 1,
    ...(options.chromiumPath === undefined ? {} : { chromiumPath: options.chromiumPath }),
    preparePage: async (page) => {
      probe = ProvenanceProbe.attach(page);
      await probe;
    },
  });
  const records: FieldRecord[] = [];
  const unmatched: { storyId: string; nodeId: string }[] = [];
  const captureFailures: { storyId: string; code: string }[] = [];
  const diagnostics = new ProvenanceDiagnostics();
  let chromium = '';
  const cost = { matchedCalls: 0, matchedMs: 0, resolveMs: 0 };
  const timed = async <T>(work: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await work();
    } finally {
      cost.matchedMs += performance.now() - started;
    }
  };
  try {
    const requests = options.storyIds.flatMap((storyId) =>
      (options.themes ?? ['light']).map((theme) => ({ storyId, theme })),
    );
    for (const { storyId, theme } of requests) {
      const globals = theme === 'light' ? {} : { globals: { theme } };
      const outcome = await capturer.capture({ storyId, screenshot: false, ...globals });
      if (!outcome.ok) {
        captureFailures.push({ storyId, code: outcome.diagnostic.code });
        continue;
      }
      chromium = outcome.doc.engine.chromium;
      const live = await probe;
      if (live === undefined) throw new Error('S-19: the capture page was not prepared.');
      const location = await live.locate(outcome.doc);
      for (const nodeId of location.unmatched) unmatched.push({ storyId, nodeId });
      const sheets = new SheetTable(await live.sheetInputs(), { repoRoot: options.repoRoot });
      const styles = new Map<number, Promise<Awaited<ReturnType<ProvenanceProbe['matched']>>>>();
      for (const located of location.located) {
        let matched = styles.get(located.nodeId);
        if (matched === undefined) {
          cost.matchedCalls++;
          matched = timed(() => live.matched(located.nodeId));
          styles.set(located.nodeId, matched);
        }
        const computed = await live.computed(located.nodeId);
        const properties = relevantFields(located.kind, computed);
        const matchedStyles = await matched;
        const started = performance.now();
        const fields = resolveNodeFields(matchedStyles, computed, properties, { sheets }, diagnostics);
        cost.resolveMs += performance.now() - started;
        for (const field of fields) {
          records.push({
            storyId,
            theme,
            component: storyId.split('--')[0] ?? storyId,
            nodeId: located.node.id,
            path: located.node.source.path,
            kind: located.kind,
            field,
            verdict: verifyField(field, read),
          });
        }
      }
    }
  } finally {
    await capturer.close();
  }
  return { records, diagnostics: diagnostics.list, unmatched, captureFailures, chromium, cost };
}
