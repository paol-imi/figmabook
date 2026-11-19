/** The result tables of `internal/spikes/S-07.md`, rendered from `S-07/results.json`. Pure. */
import { FAULT_KINDS } from './faults.ts';
import type { FaultRun, LoopRun, Results } from './results.ts';
import { ratio } from './stats.ts';

const row = (cells: readonly (string | number)[]): string => `| ${cells.join(' | ')} |`;

function table(head: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  return [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
}

export function loopTable(loops: readonly LoopRun[]): string {
  const urlFor = (loop: LoopRun) =>
    loops.find((other) => other.driver === 'url' && other.order === loop.order && other.pages === loop.pages);
  return table(
    ['Run', 'Variants', 'Failed', 'p50 ms', 'p95 ms', 'max ms', 'Variants/s', 'Renders/variant', 'vs URL'],
    loops.map((loop) => [
      loop.name,
      loop.variants,
      loop.failures,
      loop.latency.p50,
      loop.latency.p95,
      loop.latency.max,
      loop.throughput,
      loop.rendersPerVariant ?? 1,
      ((url) => (url === undefined ? '–' : `${ratio(loop.throughput, url.throughput).toFixed(2)}×`))(urlFor(loop)),
    ]),
  );
}

export function switchTable(loops: readonly LoopRun[]): string {
  const rows = loops.flatMap((loop) =>
    loop.bySwitch === undefined
      ? []
      : [
          [loop.name, 'story switch', loop.bySwitch.switch.n, loop.bySwitch.switch.p50, loop.bySwitch.switch.p95],
          [loop.name, 'args only', loop.bySwitch.argsOnly.n, loop.bySwitch.argsOnly.p50, loop.bySwitch.argsOnly.p95],
        ],
  );
  return table(['Run', 'Variant kind', 'n', 'p50 ms', 'p95 ms'], rows);
}

export function faultTable(runs: readonly FaultRun[]): string {
  const rows: (string | number)[][] = [];
  for (const kind of FAULT_KINDS) {
    for (const run of runs) {
      const faults = run.faults.filter((fault) => fault.kind === kind);
      if (faults.length === 0) continue;
      const heuristic = [...new Set(faults.flatMap((fault) => fault.planHeuristic ?? []))];
      const observed = [
        [...new Set(faults.map((fault) => fault.observed))].join(' / '),
        ...(heuristic.length === 0 ? [] : [`(03 §5.5 heuristic: ${heuristic.join('/')})`]),
      ].join(' ');
      const ms = faults.map((fault) => fault.ms).sort((a, b) => a - b);
      const recovery = [
        ...new Set(
          faults.map((fault) =>
            fault.recoveryPath === undefined ? 'navigation' : `${fault.recoveryPath}: ${fault.recoverySteps ?? ''}`,
          ),
        ),
      ].join(', ');
      rows.push([
        kind,
        run.driver,
        faults[0]?.expected ?? '',
        observed,
        `${faults.filter((fault) => fault.detected).length}/${faults.length}`,
        ms[Math.floor((ms.length - 1) / 2)] ?? 0,
        `${faults.filter((fault) => fault.recovered).length}/${faults.length}`,
        Math.max(...faults.map((fault) => fault.recoveryMs)),
        recovery,
      ]);
    }
  }
  return table(
    [
      'Fault',
      'Driver',
      'Expected',
      'Observed',
      'Detected',
      'Detect ms (median)',
      'Recovered',
      'Recovery max ms',
      'Recovery path',
    ],
    rows,
  );
}

export function renderReport(results: Results): string {
  const env = results.environment;
  const parts = [
    '## Environment',
    table(
      ['Chromium', 'Storybook', 'Framework', 'Playwright', 'Node', 'OS', 'CPUs'],
      [[env.chromium, env.storybook, env.framework, env.playwright, env.node, env.os, `${env.cpus} × ${env.cpuModel}`]],
    ),
  ];
  if (results.metadata !== undefined) {
    const { stories, loadStoryMs, readyMs } = results.metadata;
    parts.push(`Metadata: \`loadStory\` for ${stories} stories took ${loadStoryMs} ms (\`ready()\` ${readyMs} ms).`);
  }
  if (results.loops.length > 0) parts.push('## Loop', loopTable(results.loops), switchTable(results.loops));
  if (results.parity !== undefined) {
    const parity = results.parity;
    const differing = parity.records.filter((record) => !record.equal);
    parts.push(
      '## Capture parity',
      `${parity.equal}/${parity.sample} capture hashes equal; ${parity.equalIgnoringReactIds}/${parity.sample} equal once React \`useId\` values are masked (channel capture ${parity.channelWallMs} ms, URL capture ${parity.urlWallMs} ms).`,
    );
    if (differing.length > 0) {
      parts.push(
        table(
          ['#', 'Variant', 'First difference'],
          differing.map((record) => [
            record.index,
            `\`${record.label}\``,
            `\`${record.difference ?? 'capture failed'}\``,
          ]),
        ),
      );
    }
  }
  if (results.faults.length > 0) {
    parts.push('## Failure injection', faultTable(results.faults));
    parts.push(
      table(
        ['Driver', 'Variants', 'Wall ms', 'Healthy p50 ms', 'Healthy p95 ms', 'Healthy failures'],
        results.faults.map((run) => [
          run.driver,
          run.variants,
          run.wallMs,
          run.healthyLatency.p50,
          run.healthyLatency.p95,
          run.healthyFailures,
        ]),
      ),
    );
  }
  if (results.hmr !== undefined) {
    const hmr = results.hmr;
    parts.push(
      '## Dev server and HMR',
      `${hmr.variants} variants, ${hmr.failures} failed. Warm p50 ${hmr.latency.p50} ms, p95 ${hmr.latency.p95} ms; first render of a CSF file p50 ${hmr.coldLatency.p50} ms, max ${hmr.coldLatency.max} ms (n=${hmr.coldLatency.n}).`,
      table(
        ['Before variant', 'Edit', 'Visible after ms', 'Result', 'Channel events'],
        hmr.edits.map((edit) => [
          edit.atVariant,
          edit.edit,
          edit.visibleAfterMs ?? '–',
          edit.note,
          edit.events.length === 0 ? '–' : edit.events.join(', '),
        ]),
      ),
    );
  }
  return `${parts.join('\n\n')}\n`;
}
