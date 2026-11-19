// @vitest-environment happy-dom
import { createDiagnostic, diagnostic } from '@holotype/shared';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
// biome-ignore lint/correctness/noUnusedImports: JSX compiles to the classic `h()` factory.
import { h } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import { createUiChannel } from '../../src/channel';
import type { MainToUiBody } from '../../src/protocol';
import { App } from '../../src/ui/App';
import { ImportScreen } from '../../src/ui/import/ImportScreen';
import { type ImportState, useImport } from '../../src/ui/import/use-import';
import { createRecordingTransport, envelope, SESSION } from '../fixtures';
import { bundleOf, zipOf } from '../support/scenes';

const READY: MainToUiBody = { t: 'ready', pluginVersion: '1.2.3', irMajors: [0], fileKey: null, registry: null };

const zipFile = (bytes: Uint8Array, name = 'library.holotype.zip') =>
  new File([new Uint8Array(bytes)], name, { type: 'application/zip' });

function renderScreen(state: ImportState) {
  const onFile = vi.fn();
  const onReset = vi.fn();
  render(<ImportScreen state={state} onFile={onFile} onReset={onReset} />);
  return { onFile, onReset };
}

describe('Import file screen: the four states (BUILD §3.2, 11 §6.11)', () => {
  it('empty: says how to get a file, with a drop zone and a file picker', async () => {
    const user = userEvent.setup();
    const { onFile } = renderScreen({ status: 'empty' });
    expect(screen.getByRole('heading', { name: 'Import a Holotype file' })).toBeInTheDocument();
    expect(screen.getByText('Drop a .holotype.zip file here, or choose one.')).toBeInTheDocument();
    const input = screen.getByLabelText('Holotype file to import');
    const click = vi.spyOn(input, 'click');
    await user.click(screen.getByRole('button', { name: 'Choose file' }));
    expect(click).toHaveBeenCalled();
    const file = zipFile(new Uint8Array([1]));
    await user.upload(input, file);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('empty: accepts a dropped file', () => {
    const { onFile } = renderScreen({ status: 'empty' });
    const zone = screen.getByText('Drop a .holotype.zip file here, or choose one.').parentElement;
    if (!zone) throw new Error('no drop zone');
    const file = zipFile(new Uint8Array([1]));
    fireEvent.dragOver(zone, { dataTransfer: { files: [file] } });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('loading: names the file and promises nothing changes yet', () => {
    renderScreen({ status: 'loading', fileName: 'library.holotype.zip' });
    const status = screen.getByRole('status', { name: 'Reading library.holotype.zip…' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Nothing changes in Figma until it checks out.');
  });

  it('error: plain words, the code, the file, and a way to pick another file', async () => {
    const user = userEvent.setup();
    const { onFile } = renderScreen({
      status: 'error',
      fileName: 'old.holotype.zip',
      diagnostic: createDiagnostic(diagnostic('APPLY_BUNDLE_CORRUPT')),
    });
    const alert = screen.getByRole('alert', { name: "This file can't be imported" });
    expect(alert).toHaveTextContent('The file is damaged, incomplete or not a Holotype file.');
    expect(alert).toHaveTextContent('Code APPLY_BUNDLE_CORRUPT');
    expect(alert).toHaveTextContent('File: old.holotype.zip');
    const file = zipFile(new Uint8Array([2]));
    await user.upload(within(alert).getByLabelText('Holotype file to import'), file);
    expect(onFile).toHaveBeenCalledWith(file);
    expect(within(alert).getByRole('button', { name: 'Choose another file' })).toBeInTheDocument();
  });

  it('error: names the features this plugin cannot build', () => {
    renderScreen({
      status: 'error',
      diagnostic: createDiagnostic(diagnostic('APPLY_UNSUPPORTED_FEATURE'), undefined, { value: 'tokens' }),
    });
    expect(screen.getByRole('alert')).toHaveTextContent("can't build yet (tokens)");
  });

  it('error: falls back to the message for codes without designer copy', () => {
    renderScreen({
      status: 'error',
      diagnostic: { code: 'APPLY_COMPONENT_FAILED', severity: 'error', message: 'Boom.' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Boom.');
  });

  it('success: counts what is being built and offers another import', async () => {
    const user = userEvent.setup();
    const { onReset } = renderScreen({
      status: 'success',
      fileName: 'library.holotype.zip',
      components: 3,
      variants: 1,
    });
    const status = screen.getByRole('status', { name: 'File accepted' });
    expect(status).toHaveTextContent('3 components with 1 variant from library.holotype.zip.');
    await user.click(within(status).getByRole('button', { name: 'Import another file' }));
    expect(onReset).toHaveBeenCalled();
  });
});

function setupApp() {
  const { transport, posted, receive } = createRecordingTransport();
  const channel = createUiChannel(transport, SESSION);
  const send = (body: MainToUiBody) => act(() => receive({ ...envelope, ...body }));
  render(<App channel={channel} uiVersion="0.0.0" />);
  send(READY);
  const sent = (t: string) => posted.filter((message) => (message as { t: string }).t === t);
  return { posted, send, sent };
}

describe('Import file flow in the app', () => {
  it('checks the file, opens a session with its manifest and serves what main asks for', async () => {
    const user = userEvent.setup();
    const { send, sent } = setupApp();
    const { manifest, files } = bundleOf();
    await user.upload(screen.getByLabelText('Holotype file to import'), zipFile(zipOf(files)));
    expect(await screen.findByRole('status', { name: 'File accepted' })).toHaveTextContent(
      '3 components with 4 variants',
    );
    expect(sent('session.open')).toEqual([{ ...envelope, t: 'session.open', manifest, source: 'file', options: {} }]);
    send({ t: 'need', unit: { kind: 'component', sid: 'components-badge' } });
    expect(sent('unit')).toMatchObject([
      { unit: { kind: 'component', sid: 'components-badge', part: 0, parts: 1 }, last: true },
    ]);
  });

  it('shows the error state for a file that is not a bundle, and opens no session', async () => {
    const user = userEvent.setup();
    const { sent } = setupApp();
    await user.upload(
      screen.getByLabelText('Holotype file to import'),
      zipFile(new TextEncoder().encode('nope'), 'notes.zip'),
    );
    const alert = await screen.findByRole('alert', { name: "This file can't be imported" });
    expect(alert).toHaveTextContent('Code APPLY_BUNDLE_CORRUPT');
    expect(alert).toHaveTextContent('File: notes.zip');
    expect(sent('session.open')).toEqual([]);
  });

  it('turns a refusal from main into the error state', async () => {
    const user = userEvent.setup();
    const { send } = setupApp();
    await user.upload(screen.getByLabelText('Holotype file to import'), zipFile(zipOf(bundleOf().files)));
    await screen.findByRole('status', { name: 'File accepted' });
    send({ t: 'error', code: 'APPLY_NO_EDIT_ACCESS', message: 'View only.', recoverable: false });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Open this file in Design mode with edit access.'),
    );
  });

  it('moves to the report when main starts building, and back to empty on "Import another file"', async () => {
    const user = userEvent.setup();
    const { send } = setupApp();
    await user.upload(screen.getByLabelText('Holotype file to import'), zipFile(zipOf(bundleOf().files)));
    await screen.findByRole('status', { name: 'File accepted' });
    send({ t: 'progress', stage: 'apply', done: 0, total: 4 });
    expect(screen.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Import file' }));
    await user.click(screen.getByRole('button', { name: 'Import another file' }));
    expect(screen.getByRole('heading', { name: 'Import a Holotype file' })).toBeInTheDocument();
  });
});

describe('useImport', () => {
  function setupHook() {
    const { transport, posted, receive } = createRecordingTransport();
    const channel = createUiChannel(transport, SESSION);
    const hook = renderHook(() => useImport(channel));
    const units = () => posted.filter((message) => (message as { t: string }).t === 'unit');
    return { hook, posted, receive, units };
  }

  const bufferOf = () => zipOf(bundleOf().files).slice().buffer;

  it('reports a file that cannot be read', async () => {
    const { hook } = setupHook();
    await act(() =>
      hook.result.current.importFile({
        name: 'gone.zip',
        arrayBuffer: () => Promise.reject(new Error('NotReadableError')),
      }),
    );
    expect(hook.result.current.state).toMatchObject({
      status: 'error',
      fileName: 'gone.zip',
      diagnostic: { code: 'APPLY_BUNDLE_CORRUPT', data: { reason: expect.stringContaining('NotReadableError') } },
    });
  });

  it('lets the latest pick win over a slower earlier one', async () => {
    const { hook, posted } = setupHook();
    let releaseFirst: (buffer: ArrayBuffer) => void = () => {};
    const first = hook.result.current.importFile({
      name: 'slow.zip',
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) => {
          releaseFirst = resolve;
        }),
    });
    await act(() => hook.result.current.importFile({ name: 'fast.zip', arrayBuffer: async () => bufferOf() }));
    releaseFirst(bufferOf());
    await act(() => first);
    expect(hook.result.current.state).toMatchObject({ status: 'success', fileName: 'fast.zip' });
    expect(posted.filter((message) => (message as { t: string }).t === 'session.open')).toHaveLength(1);
  });

  it('stops serving the previous bundle when another one opens, and on unmount', async () => {
    const { hook, receive, units } = setupHook();
    await act(() => hook.result.current.importFile({ name: 'a.zip', arrayBuffer: async () => bufferOf() }));
    await act(() => hook.result.current.importFile({ name: 'b.zip', arrayBuffer: async () => bufferOf() }));
    receive({ ...envelope, t: 'need', unit: { kind: 'tokens' } });
    expect(units()).toHaveLength(1);
    hook.unmount();
    receive({ ...envelope, t: 'need', unit: { kind: 'tokens' } });
    expect(units()).toHaveLength(1);
  });
});
