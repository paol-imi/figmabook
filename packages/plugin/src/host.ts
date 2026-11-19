/*
 * The main-thread side of a UI session: handshake, version gate, cancel flag and the
 * ping/pong yield (09 §3, §12). It never touches the `figma` global; `main.ts` injects
 * what it needs, so the host is tested without Figma.
 */
import { parseMajor } from '@holotype/ir/core';
import { APPLY_IR_VERSION_UNSUPPORTED, createDiagnostic, HolotypeError } from '@holotype/shared';
import type { MainChannel } from './channel';
import type { MessageOf, RegistrySummary, UiToMain } from './protocol';

export type SessionOpen = MessageOf<UiToMain, 'session.open'>;

export interface HostOptions {
  readonly channel: MainChannel;
  readonly pluginVersion: string;
  /** Scene IR majors this build can apply (`SUPPORTED_SCENE_MAJORS`). */
  readonly irMajors: readonly number[];
  /** Read on every `hello`, because the file can change between UI reloads. */
  readonly fileKey: () => string | null;
  readonly registry?: () => RegistrySummary | null;
  /**
   * Runs an accepted session: pulls units and applies them (B-14). Called only after the
   * version gate passed. A `HolotypeError` it throws is reported to the UI as `error`.
   */
  readonly openSession?: (message: SessionOpen, host: Host) => Promise<void>;
}

export interface Host {
  /** Set by the UI's `cancel`; cleared when the next session opens. Checked between work units (09 §12). */
  readonly cancelRequested: boolean;
  /** Yields to the editor with a `ping` → `pong` round trip through the UI (09 §12 fallback). */
  uiRoundTrip(signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

export function startHost(options: HostOptions): Host {
  const { channel } = options;
  let cancelRequested = false;
  let pingId = 0;

  const host: Host = {
    get cancelRequested() {
      return cancelRequested;
    },
    async uiRoundTrip(signal) {
      pingId += 1;
      const id = pingId;
      // Late pongs from an earlier, aborted round trip are skipped.
      const pong = channel.next('pong', { ...(signal ? { signal } : {}), where: (message) => message.id === id });
      channel.send({ t: 'ping', id });
      await pong;
    },
    dispose: () => {
      for (const off of subscriptions) off();
    },
  };

  const subscriptions = [
    channel.on('hello', () => {
      cancelRequested = false;
      channel.send({
        t: 'ready',
        pluginVersion: options.pluginVersion,
        irMajors: options.irMajors,
        fileKey: options.fileKey(),
        registry: options.registry?.() ?? null,
      });
    }),
    channel.on('cancel', () => {
      cancelRequested = true;
    }),
    channel.on('session.open', (message) => {
      cancelRequested = false;
      const { sceneVersion } = message.manifest;
      const major = parseMajor(sceneVersion);
      if (major === undefined || !options.irMajors.includes(major)) {
        const diagnostic = createDiagnostic(APPLY_IR_VERSION_UNSUPPORTED, {
          document: 'Bundle format', // user-facing: never "IR" in UI copy (11 §6.12)
          found: sceneVersion,
          supported: options.irMajors.join(', '),
        });
        channel.send({ t: 'error', code: diagnostic.code, message: diagnostic.message, recoverable: false });
        return;
      }
      void options.openSession?.(message, host).catch((error: unknown) => {
        if (!(error instanceof HolotypeError) || error.diagnostics[0] === undefined) throw error;
        const [first] = error.diagnostics;
        channel.send({ t: 'error', code: first.code, message: first.message, recoverable: first.severity !== 'fatal' });
      });
    }),
  ];

  return host;
}
