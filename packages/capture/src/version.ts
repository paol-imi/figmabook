import { createRequire } from 'node:module';
import { version } from '../package.json';

const require = createRequire(import.meta.url);

/** This package's version: `CaptureDoc.engine.version` and the capture user agent. */
export const ENGINE_VERSION: string = version;

/** The Playwright version in use, part of the capture cache key (05 §10.2). */
export const PLAYWRIGHT_VERSION: string = (require('playwright/package.json') as { version: string }).version;
