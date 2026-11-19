/*
 * The Import file flow (11 §2.3): read and check the file, then open a session with main and
 * serve its units until another file is imported. It lives in `App`, not in the screen, so
 * serving goes on while the user watches the Report tab.
 */
import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { UiChannel } from '../../channel';
import { type ReadBundleOptions, readBundle } from './bundle';
import { serveBundle } from './serve';

export type ImportState =
  | { readonly status: 'empty' }
  | { readonly status: 'loading'; readonly fileName: string }
  | { readonly status: 'error'; readonly fileName?: string; readonly diagnostic: Diagnostic }
  | {
      readonly status: 'success';
      readonly fileName: string;
      readonly components: number;
      readonly variants: number;
    };

/** The part of a `File` the import reads. */
export interface ImportFile {
  readonly name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface Importer {
  readonly state: ImportState;
  importFile(file: ImportFile): Promise<void>;
  /** Back to the empty state, to pick another file. */
  reset(): void;
}

export const EMPTY: ImportState = { status: 'empty' };

const unreadable = (error: unknown): Diagnostic =>
  createDiagnostic(diagnostic('APPLY_BUNDLE_CORRUPT'), undefined, {
    data: { reason: `the file could not be read: ${error instanceof Error ? error.message : String(error)}` },
  });

const DEFAULT_OPTIONS: ReadBundleOptions = Object.freeze({});

export function useImport(channel: UiChannel, options: ReadBundleOptions = DEFAULT_OPTIONS): Importer {
  const [state, setState] = useState<ImportState>(EMPTY);
  const stopServing = useRef<(() => void) | undefined>(undefined);
  // Only the latest pick may update the state: a slow earlier read must not win.
  const attempt = useRef(0);

  useEffect(
    () => () => {
      stopServing.current?.();
    },
    [],
  );

  // Main can still refuse the bundle after the UI accepted it (e.g. no edit access).
  useEffect(
    () =>
      channel.on('error', ({ code, message }) =>
        setState((current) =>
          current.status === 'success'
            ? { status: 'error', fileName: current.fileName, diagnostic: { code, severity: 'error', message } }
            : current,
        ),
      ),
    [channel],
  );

  const importFile = useCallback(
    async (file: ImportFile) => {
      attempt.current += 1;
      const mine = attempt.current;
      const fileName = file.name;
      setState({ status: 'loading', fileName });
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        if (mine === attempt.current) setState({ status: 'error', fileName, diagnostic: unreadable(error) });
        return;
      }
      const result = await readBundle(fileName, bytes, options);
      if (mine !== attempt.current) return;
      if (!result.ok) {
        setState({ status: 'error', fileName, diagnostic: result.error });
        return;
      }
      stopServing.current?.();
      const bundle = result.value;
      stopServing.current = serveBundle(channel, bundle);
      channel.send({ t: 'session.open', manifest: bundle.manifest, source: 'file', options: {} });
      setState({ status: 'success', fileName, ...bundle.totals });
    },
    [channel, options],
  );

  const reset = useCallback(() => {
    attempt.current += 1;
    setState(EMPTY);
  }, []);

  return { state, importFile, reset };
}
