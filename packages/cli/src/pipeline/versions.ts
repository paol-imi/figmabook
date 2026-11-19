import { createRequire } from 'node:module';
import { version as cliVersion } from '../../package.json';

const require = createRequire(import.meta.url);

const versionOf = (name: string): string => (require(`${name}/package.json`) as { version: string }).version;

/** This package's version: `generator.version` and the human output header. */
export const CLI_VERSION: string = cliVersion;

/** The mapper in use (`generator.mapper`, 06 §4.2). */
export const MAPPER_VERSION: string = versionOf('@holotype/mapper');
