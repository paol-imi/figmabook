import { componentIdFromStoryId } from '@holotype/storybook';
import { captureVariant, type EngineInfo } from './capture-variant';
import { resolveEnvironment } from './environment';
import { type CaptureSession, ChromiumBackend } from './pool/chromium';
import { CapturePool } from './pool/pool';
import { serializerSource } from './serializer-source';
import type { CaptureOutcome, CaptureRequest, Capturer, CapturerOptions } from './types';
import { ENGINE_VERSION, PLAYWRIGHT_VERSION } from './version';
import { resolveWorkerCount } from './workers';

/**
 * Creates a capturer (05 §1): one Chromium with the D-24 environment and N workers, each a
 * browser context with one long-lived page. The browser starts on the first capture;
 * variants of one component (`sid`) always run on the same worker, in order.
 */
export function createCapturer(options: CapturerOptions): Capturer {
  const env = resolveEnvironment(options.config);
  const workers = resolveWorkerCount(options.workers ?? options.config?.workers ?? 'auto');
  const backend = new ChromiumBackend({
    env,
    storybook: options.storybook,
    serializer: serializerSource,
    engineVersion: ENGINE_VERSION,
    ...(options.chromiumPath === undefined ? {} : { chromiumPath: options.chromiumPath }),
    ...(options.launch === undefined ? {} : { launch: options.launch }),
    ...(options.renderTimeoutMs === undefined ? {} : { renderTimeoutMs: options.renderTimeoutMs }),
    ...(options.preparePage === undefined ? {} : { preparePage: options.preparePage }),
  });
  const pool = new CapturePool<CaptureSession>(backend, {
    size: workers,
    ...(options.recycleAfter === undefined ? {} : { recycleAfter: options.recycleAfter }),
  });
  let engine: Promise<EngineInfo> | undefined;
  const engineInfo = () => {
    engine ??= backend.info().then(
      ({ version }) => ({ version: ENGINE_VERSION, chromium: version, playwright: PLAYWRIGHT_VERSION }),
      (error: unknown) => {
        engine = undefined;
        throw error;
      },
    );
    return engine;
  };
  let closing: Promise<void> | undefined;

  return {
    workers,
    async capture(request: CaptureRequest): Promise<CaptureOutcome> {
      if (closing !== undefined) throw new Error('capture() after close(): the capturer is closed.');
      const info = await engineInfo();
      const key = request.sid ?? componentIdFromStoryId(request.storyId);
      return pool.run(key, (session, { attempt }) => captureVariant(session, request, { env, engine: info, attempt }));
    },
    close() {
      closing ??= pool.close().finally(() => backend.close());
      return closing;
    },
  };
}
