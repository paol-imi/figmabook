import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import { fetchText, parseJsonBody } from '../http';

/**
 * The Storybook 10 components manifest (`manifests/components.json`, 03 §2.3). Its schema is not
 * a public API, so it is read loosely: only what `CodeRef` needs (15 §5.3), and an unknown shape
 * is `SB_MANIFEST_UNPARSEABLE` (info).
 */

/** What the manifest says about one component (keyed by component id, the `sid`). */
export interface ManifestComponent {
  readonly id: string;
  /** The component's export name, from its docgen (`reactDocgen.exportName`). */
  readonly exportName?: string;
  /** The package the stories import the component from, e.g. `@acme/ui`. */
  readonly package?: string;
}

export type ComponentsManifest = ReadonlyMap<string, ManifestComponent>;

export const MANIFEST_PATH = 'manifests/components.json';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const IMPORT = /import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g;

/** The bare package of a module specifier: `@scope/name/sub` → `@scope/name`; relative → `undefined`. */
export function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || /^[a-z]+:/i.test(specifier)) return undefined;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The package an `import { … } from '…'` snippet takes `name` from. */
export function packageFromImports(snippet: string, name: string): string | undefined {
  for (const match of snippet.matchAll(IMPORT)) {
    const names = (match[1] ?? '').split(',').map((part) =>
      part
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim(),
    );
    if (names.includes(name)) return packageOf(match[3] ?? '');
  }
  return undefined;
}

/** Parses the manifest; `undefined` for an unknown shape. */
export function parseComponentsManifest(json: unknown): ComponentsManifest | undefined {
  if (!isRecord(json) || !isRecord(json.components)) return undefined;
  const components = new Map<string, ManifestComponent>();
  for (const [key, raw] of Object.entries(json.components)) {
    if (!isRecord(raw)) return undefined;
    const id = str(raw.id) ?? key;
    const docgen = isRecord(raw.reactDocgen) ? raw.reactDocgen : {};
    const exportName = str(docgen.exportName) ?? str(docgen.actualName) ?? str(docgen.displayName);
    const snippet = str(raw.import);
    const pkg = exportName === undefined || snippet === undefined ? undefined : packageFromImports(snippet, exportName);
    components.set(id, {
      id,
      ...(exportName === undefined ? {} : { exportName }),
      ...(pkg === undefined ? {} : { package: pkg }),
    });
  }
  return components;
}

export interface LoadedManifest {
  readonly manifest?: ComponentsManifest;
  readonly diagnostics: Diagnostic[];
}

/**
 * Fetches and parses the manifest of a Storybook. A missing manifest (404, network error, a body
 * that is not JSON) is not a problem: the flag is off in most projects; it gives an empty result.
 */
export async function loadComponentsManifest(baseUrl: string, timeoutMs: number): Promise<LoadedManifest> {
  const url = new URL(MANIFEST_PATH, baseUrl).href;
  const outcome = await fetchText(url, timeoutMs);
  if (outcome.kind !== 'response' || outcome.status !== 200) return { diagnostics: [] };
  const json = parseJsonBody(outcome.body);
  // Not JSON at all: a host that answers every path with its index page.
  if (json === undefined) return { diagnostics: [] };
  const manifest = parseComponentsManifest(json);
  if (manifest !== undefined) return { manifest, diagnostics: [] };
  return {
    diagnostics: [
      createDiagnostic(diagnostic('SB_MANIFEST_UNPARSEABLE'), undefined, {
        value: url,
        fallback: 'in-page docgen',
        data: { url },
      }),
    ],
  };
}
