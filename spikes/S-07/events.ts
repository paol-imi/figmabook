/** Channel event summaries for the report. Pure. */
import type { PageEvent } from './driver/page.ts';

/**
 * Event names with counts; `←` came from a transport, `→` was emitted in the page. An `in`
 * event that repeats an earlier `out` event of the same name is the postMessage echo: dropped.
 */
export function summarizeEvents(events: readonly Pick<PageEvent, 'dir' | 'event'>[]): string[] {
  const counts = new Map<string, number>();
  const unechoed = new Map<string, number>();
  for (const entry of events) {
    if (entry.event === 'storyRenderPhaseChanged') continue;
    if (entry.dir === 'out') unechoed.set(entry.event, (unechoed.get(entry.event) ?? 0) + 1);
    else if ((unechoed.get(entry.event) ?? 0) > 0) {
      unechoed.set(entry.event, (unechoed.get(entry.event) ?? 0) - 1);
      continue;
    }
    const name = `${entry.dir === 'in' ? '←' : '→'}${entry.event}`;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => (count === 1 ? name : `${name}×${count}`));
}
