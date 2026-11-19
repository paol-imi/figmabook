// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpikeDefinition } from '../../_shared/spike.ts';
import type { Bridge } from '../src/bridge.ts';
import { App } from '../src/ui/App.tsx';
import { connect } from './support/harness.ts';

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Figma/125.1.5 Chrome/130.0';

let release: (() => void) | undefined;

const sample: SpikeDefinition = {
  id: 'S-99',
  title: 'Sample spike',
  question: 'Does the runner show each state?',
  userTime: '1 min',
  steps: [
    {
      id: 'step1',
      label: 'Step 1',
      where: 'the file "Spikes Scratch"',
      before: ['Builds one test frame.'],
      after: ['Paste the results in the chat.'],
      run: async (io) => {
        io.progress('Building the test frame…');
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        const answer = await io.ask({ kind: 'continue', lines: ['Publish the library now, then click Continue.'] });
        return { results: { answers: { ok: true, answer: answer.choice } } };
      },
    },
    {
      id: 'step2',
      label: 'Step 2',
      where: 'the file "Spikes Consumer"',
      run: async () => {
        throw new Error('Run Step 1 first.');
      },
    },
    {
      id: 'big',
      label: 'Big result',
      where: 'any file',
      run: async () => ({ results: { blob: 'x'.repeat(70_000) } }),
    },
  ],
};

function renderApp(bridge: Bridge = connect().bridge) {
  return render(<App spikes={[sample]} bridge={bridge} kitVersion="0.1.0" userAgent={DESKTOP_UA} />);
}

async function openSample() {
  fireEvent.click(await screen.findByRole('button', { name: /S-99 · Sample spike/ }));
  await screen.findByText('Does the runner show each state?');
}

afterEach(() => {
  cleanup();
  release = undefined;
});

describe('Holotype Spikes window', () => {
  it('shows a starting state, then the spike list', async () => {
    renderApp();
    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /S-99 · Sample spike/ })).toBeTruthy();
    expect(screen.getByText(/3 steps · about 1 min/)).toBeTruthy();
    expect(screen.getByText('kit 0.1.0')).toBeTruthy();
  });

  it('shows an error when the main thread does not answer correctly', async () => {
    const bridge: Bridge = { call: () => Promise.reject(new Error('main is gone')), dispose: () => {} };
    renderApp(bridge);
    expect((await screen.findByRole('alert')).textContent).toContain('main is gone');
  });

  it('runs a step: progress, a manual step, then Done with Copy results', async () => {
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    renderApp();
    await openSample();
    expect(screen.getByText('Run in: the file "Spikes Scratch"')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run Step 1' }));
    expect(await screen.findByText(/Building the test frame/)).toBeTruthy();
    release?.();
    expect(await screen.findByText('Publish the library now, then click Continue.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Done')).toBeTruthy();
    expect(screen.getByText('Paste the results in the chat.')).toBeTruthy();
    const text = (screen.getByLabelText('Result text') as HTMLTextAreaElement).value;
    expect(JSON.parse(text)).toMatchObject({
      spike: 'S-99',
      step: 'step1',
      status: 'done',
      env: { client: 'desktop', os: 'macos' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Copy results' }));
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByRole('status').textContent).toBe('Copied. Paste it in the chat.');

    fireEvent.click(screen.getByRole('button', { name: '← Back to the steps' }));
    expect(await screen.findByText('Done', { selector: '.badge' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show last result' }));
    expect(await screen.findByRole('button', { name: 'Copy results' })).toBeTruthy();
  });

  it('shows a failed step with its error and Copy error report', async () => {
    document.execCommand = vi.fn(() => false);
    renderApp();
    await openSample();
    fireEvent.click(screen.getByRole('button', { name: 'Run Step 2' }));
    expect(await screen.findByText('Failed')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Run Step 1 first.');
    fireEvent.click(screen.getByRole('button', { name: 'Copy error report' }));
    expect(screen.getByRole('status').textContent).toMatch(/Copy did not work/);
  });

  it('splits a large result into numbered parts', async () => {
    document.execCommand = vi.fn(() => true);
    renderApp();
    await openSample();
    fireEvent.click(screen.getByRole('button', { name: 'Run Big result' }));
    expect(await screen.findByRole('button', { name: 'Copy part 1 of 3' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy part 2 of 3' }));
    expect(screen.getByRole('status').textContent).toBe('Part 2 of 3 copied. Paste it in the chat.');
    expect((screen.getByLabelText('Result text') as HTMLTextAreaElement).value).toMatch(
      /^HOLOTYPE-SPIKE-PART S-99 big 2\/3\n/,
    );
  });

  it('forgets saved steps on Start over', async () => {
    renderApp();
    await openSample();
    fireEvent.click(screen.getByRole('button', { name: 'Run Step 2' }));
    fireEvent.click(await screen.findByRole('button', { name: '← Back to the steps' }));
    expect(await screen.findByText('Failed', { selector: '.badge' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Start over/ }));
    await waitFor(() => expect(screen.queryByText('Failed', { selector: '.badge' })).toBeNull());
  });
});
