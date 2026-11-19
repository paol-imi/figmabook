/*
 * @holotype/capture: the capture engine (05). Playwright orchestration in Node, and the
 * in-page serializer shipped as one IIFE string.
 */
export { canonicalCapture, captureHash, stableCapture, VOLATILE_CAPTURE_FIELDS } from './canonical';
export { createCapturer } from './capturer';
export {
  type CaptureConfig,
  type CaptureEnvironment,
  CHROMIUM_ARGS,
  captureUserAgent,
  contextOptions,
  DEFAULT_ENVIRONMENT,
  RANDOM_SEED,
  resolveEnvironment,
  STORYBOOK_TEST_RUNNER_UA,
  seededRandomScript,
} from './environment';
export { PAGE_GLOBAL, type PageSerializer } from './page/serializer';
export type { PageCapture, PageDiagnostic, PageDiagnosticCode, SerializeOptions } from './page/types';
export { SERIALIZER_PROTOCOL } from './page/types';
export { serializerSource } from './serializer-source';
export type {
  CaptureFailure,
  CaptureOutcome,
  CaptureRequest,
  Capturer,
  CapturerOptions,
  CaptureSuccess,
} from './types';
export { ENGINE_VERSION, PLAYWRIGHT_VERSION } from './version';
export { currentHost, resolveWorkerCount, type WorkerHost } from './workers';
