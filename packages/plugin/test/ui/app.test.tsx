// @vitest-environment happy-dom
import { act, render, screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
// biome-ignore lint/correctness/noUnusedImports: JSX compiles to the classic `h()` factory.
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import { createUiChannel } from '../../src/channel';
import type { MainToUiBody } from '../../src/protocol';
import { App, TABS, type TabId } from '../../src/ui/App';
import { createRecordingTransport, envelope, SESSION } from '../fixtures';

const READY: MainToUiBody = { t: 'ready', pluginVersion: '1.2.3', irMajors: [0], fileKey: null, registry: null };

function setup({ ready = true, initialTab }: { ready?: boolean; initialTab?: TabId } = {}) {
  const { transport, posted, receive } = createRecordingTransport();
  const channel = createUiChannel(transport, SESSION);
  const send = (body: MainToUiBody) => act(() => receive({ ...envelope, ...body }));
  render(<App channel={channel} uiVersion="0.0.0" handshakeTimeoutMs={50} {...(initialTab ? { initialTab } : {})} />);
  if (ready) send(READY);
  return { posted, send };
}

const panel = () => screen.getByRole('tabpanel');

describe('App shell', () => {
  it('says hello and shows a loading state until main is ready', () => {
    const { posted, send } = setup({ ready: false });
    expect(posted).toEqual([{ ...envelope, t: 'hello', uiVersion: '0.0.0' }]);
    expect(screen.getByRole('status', { name: 'Starting Holotype…' })).toHaveAttribute('aria-busy', 'true');
    send(READY);
    expect(screen.getByRole('tablist', { name: 'Holotype sections' })).toBeInTheDocument();
  });

  it('shows an error with a retry when main never answers, and retries the handshake', async () => {
    const user = userEvent.setup();
    const { posted, send } = setup({ ready: false });
    const alert = await screen.findByRole('alert', { name: "Holotype didn't start" });
    expect(alert).toHaveTextContent('Close the plugin, then run it again');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(posted.filter((message) => (message as { t: string }).t === 'hello')).toHaveLength(2));
    expect(screen.getByRole('status', { name: 'Starting Holotype…' })).toBeInTheDocument();
    send(READY);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('shows the four sections in order, opening on Import file', () => {
    setup();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(TABS.map((tab) => tab.label));
    expect(TABS.map((tab) => tab.label)).toEqual(['Library', 'Import file', 'Report', 'Settings']);
    expect(screen.getByRole('tab', { name: 'Import file' })).toHaveAttribute('aria-selected', 'true');
  });

  it('answers ping with pong (09 §12)', () => {
    const { posted, send } = setup();
    send({ t: 'ping', id: 4 });
    expect(posted).toContainEqual({ ...envelope, t: 'pong', id: 4 });
  });
});

describe('empty state of each section', () => {
  it('Library: coming soon, with a way to import a file instead', async () => {
    const user = userEvent.setup();
    setup({ initialTab: 'library' });
    expect(within(panel()).getByRole('heading', { name: 'Coming soon' })).toBeInTheDocument();
    await user.click(within(panel()).getByRole('button', { name: 'Import a file' }));
    expect(screen.getByRole('tab', { name: 'Import file' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Import file: how to get a file to import', () => {
    setup({ initialTab: 'import' });
    expect(within(panel()).getByRole('heading', { name: 'Import a Holotype file' })).toBeInTheDocument();
    expect(panel()).toHaveTextContent('npx holotype export');
  });

  it('Report: no report yet', () => {
    setup({ initialTab: 'report' });
    expect(within(panel()).getByRole('heading', { name: 'No report yet' })).toBeInTheDocument();
  });

  it('Settings: coming soon, with the plugin version', () => {
    setup({ initialTab: 'settings' });
    expect(within(panel()).getByRole('heading', { name: 'Coming soon' })).toBeInTheDocument();
    expect(panel()).toHaveTextContent('Plugin version1.2.3');
    expect(panel()).toHaveTextContent('Bundle formatsv0');
  });
});

describe('Report states', () => {
  it('loading: progress brings the report into view, with a step, a bar and Cancel', async () => {
    const user = userEvent.setup();
    const { posted, send } = setup({ initialTab: 'library' });
    send({ t: 'progress', stage: 'apply', done: 2, total: 5 });
    expect(screen.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
    const status = within(panel()).getByRole('status', { name: 'Importing components…' });
    expect(status).toHaveTextContent('Building components: 2 of 5');
    expect(within(status).getByRole('progressbar')).toHaveAttribute('value', '2');
    await user.click(within(status).getByRole('button', { name: 'Cancel import' }));
    expect(posted).toContainEqual({ ...envelope, t: 'cancel' });
  });

  it('error: the message and the diagnostic code', () => {
    const { send } = setup({ initialTab: 'report' });
    send({
      t: 'error',
      code: 'APPLY_IR_VERSION_UNSUPPORTED',
      message: 'Bundle format version 3.0.0 is not supported.',
      recoverable: false,
    });
    const alert = within(panel()).getByRole('alert', { name: 'Import stopped' });
    expect(alert).toHaveTextContent('Code APPLY_IR_VERSION_UNSUPPORTED');
  });

  it('success: counts with plurals, failures and messages', () => {
    const { send } = setup({ initialTab: 'report' });
    send({ t: 'diagnostics', items: [{ code: 'FONT_MISSING', severity: 'warn', message: 'Missing.' }] });
    send({
      t: 'done',
      summary: { componentsOk: 1, componentsFailed: 2, variants: 12, durationMs: 3450, cancelled: false },
    });
    const status = within(panel()).getByRole('status', { name: '1 component imported' });
    expect(status).toHaveTextContent('12 variants in 3.5 s');
    expect(status).toHaveTextContent('2 components failed. Run the import again to finish them.');
    expect(status).toHaveTextContent('1 message');
  });

  it('success without failures or messages', () => {
    const { send } = setup({ initialTab: 'report' });
    send({
      t: 'done',
      summary: { componentsOk: 3, componentsFailed: 0, variants: 1, durationMs: 100, cancelled: false },
    });
    const status = within(panel()).getByRole('status', { name: '3 components imported' });
    expect(status).toHaveTextContent('1 variant in 0.1 s');
    expect(status).not.toHaveTextContent('failed');
    expect(status).toHaveTextContent('No warnings');
  });

  it('cancelled: says what was kept', () => {
    const { send } = setup({ initialTab: 'report' });
    send({
      t: 'done',
      summary: { componentsOk: 1, componentsFailed: 0, variants: 2, durationMs: 10, cancelled: true },
    });
    expect(within(panel()).getByRole('region', { name: 'Import cancelled' })).toHaveTextContent(
      'Finished components were kept.',
    );
  });
});
