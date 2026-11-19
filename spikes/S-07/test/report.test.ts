import { describe, expect, it } from 'vitest';
import { faultTable, loopTable, renderReport, switchTable } from '../report.ts';
import { formatResults, type LoopRun, RESULTS_FORMAT, type Results } from '../results.ts';
import { summarize } from '../stats.ts';

const loop = (name: string, driver: 'channel' | 'url', throughput: number, extra: Partial<LoopRun> = {}): LoopRun => ({
  name,
  driver,
  userAgent: 'test-runner',
  order: 'grouped',
  pages: 1,
  variants: 3,
  failures: 0,
  wallMs: 300,
  throughput,
  latency: summarize([10, 20, 30]),
  records: [],
  ...extra,
});

const results: Results = {
  format: RESULTS_FORMAT,
  environment: {
    chromium: '150.0.0.0',
    storybook: '10.6.7',
    framework: '@storybook/react-vite',
    node: 'v22.0.0',
    playwright: '1.63.0',
    os: 'linux 6',
    cpus: 4,
    cpuModel: 'cpu',
  },
  metadata: { stories: 2, loadStoryMs: 12, readyMs: 1 },
  loops: [
    loop('channel', 'channel', 20, {
      rendersPerVariant: 1.5,
      bySwitch: { switch: summarize([40]), argsOnly: summarize([20, 30]) },
    }),
    loop('url', 'url', 4),
  ],
  parity: {
    sample: 2,
    equal: 1,
    equalIgnoringReactIds: 1,
    channelWallMs: 100,
    urlWallMs: 200,
    records: [
      { index: 0, label: 'a', channelHash: 'h', urlHash: 'h', equal: true, equalIgnoringReactIds: true },
      {
        index: 5,
        label: 'b',
        channelHash: 'h1',
        urlHash: 'h2',
        equal: false,
        difference: '$.x (1 vs 2)',
        equalIgnoringReactIds: false,
      },
    ],
  },
  faults: [
    {
      driver: 'channel',
      variants: 10,
      wallMs: 500,
      healthyLatency: summarize([10]),
      healthyFailures: 0,
      faults: [
        {
          index: 5,
          kind: 'throws',
          expected: 'SB_STORY_ERROR',
          observed: 'SB_STORY_ERROR',
          detected: true,
          ms: 30,
          recovered: true,
          recoveryMs: 40,
          recoveryPath: 'channel',
          recoverySteps: 'select',
        },
        {
          index: 15,
          kind: 'unstable',
          expected: 'ok + CAP_UNSTABLE_RENDER',
          observed: 'ok + CAP_UNSTABLE_RENDER',
          detected: true,
          ms: 150,
          recovered: true,
          recoveryMs: 40,
          recoveryPath: 'channel',
          recoverySteps: 'select',
          planHeuristic: 'stable',
        },
      ],
    },
  ],
};

describe('report tables', () => {
  it('compares each loop with the URL loop of the same order', () => {
    const lines = loopTable(results.loops).split('\n');
    expect(lines[0]).toBe(
      '| Run | Variants | Failed | p50 ms | p95 ms | max ms | Variants/s | Renders/variant | vs URL |',
    );
    expect(lines[2]).toBe('| channel | 3 | 0 | 20 | 30 | 30 | 20 | 1.5 | 5.00× |');
    expect(lines[3]).toBe('| url | 3 | 0 | 20 | 30 | 30 | 4 | 1 | 1.00× |');
  });

  it('splits channel latency into story switches and args-only updates', () => {
    expect(switchTable(results.loops).split('\n').slice(2)).toEqual([
      '| channel | story switch | 1 | 40 | 40 |',
      '| channel | args only | 2 | 20 | 30 |',
    ]);
  });

  it('lists detection and recovery per fault kind, with the 03 heuristic for unstable roots', () => {
    const lines = faultTable(results.faults).split('\n');
    expect(lines[2]).toBe(
      '| throws | channel | SB_STORY_ERROR | SB_STORY_ERROR | 1/1 | 30 | 1/1 | 40 | channel: select |',
    );
    expect(lines[3]).toContain('(03 §5.5 heuristic: stable)');
  });

  it('renders every section that has results', () => {
    const report = renderReport(results);
    for (const heading of ['## Environment', '## Loop', '## Capture parity', '## Failure injection']) {
      expect(report).toContain(heading);
    }
    expect(report).not.toContain('## Dev server and HMR');
    expect(report).toContain('1/2 capture hashes equal; 1/2 equal once React `useId` values are masked');
    expect(report).toContain('| 5 | `b` | `$.x (1 vs 2)` |');
  });
});

describe('formatResults', () => {
  it('writes one line per record and parses back to the same value', () => {
    const withRecords: Results = {
      ...results,
      loops: [
        loop('channel', 'channel', 20, {
          records: [
            { index: 0, storyId: 'a--b', ok: true, warnings: [], ms: 1.5 },
            { index: 1, storyId: 'a--"q"', ok: false, code: 'SB_STORY_ERROR', warnings: ['SB_CONSOLE_ERROR'], ms: 2 },
          ],
        }),
      ],
    };
    const text = formatResults(withRecords);
    expect(JSON.parse(text)).toEqual(withRecords);
    expect(text).toContain('\n        {"index":0,"storyId":"a--b","ok":true,"warnings":[],"ms":1.5},\n');
    expect(text.endsWith('}\n')).toBe(true);
  });
});
