import { defineConfig } from 'tsdown';
import { emitScript } from '../../tsdown.shared.ts';

/**
 * Bundles the schema emitter from source (workspace packages through the `@holotype/source`
 * condition), so `pnpm -F @holotype/ir build` works without building its workspace dependencies first.
 */
export default defineConfig(emitScript({ 'emit-schemas': 'scripts/emit-schemas.ts' }));
