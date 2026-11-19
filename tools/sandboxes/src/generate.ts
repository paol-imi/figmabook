/**
 * Writes a throwaway Storybook sandbox: a template's files, the overlays' files and a
 * generated `package.json`, plus `holotype-sandbox.json`, which records what was generated.
 * Output is deterministic: the same options give the same bytes.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkOverlay, findTemplate, resolveStorybookVersion, type SandboxTemplate } from './templates.ts';

export const MANIFEST_FILE = 'holotype-sandbox.json';
export const MANIFEST_FORMAT = 'holotype-sandbox/1';

/** The package root (`tools/sandboxes`): templates and overlays are read from here. */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Where sandboxes go by default. Ignored by git (`tools/sandboxes/.gitignore`). */
export const DEFAULT_OUT_ROOT = join(PACKAGE_ROOT, '.out');

export interface SandboxSpec {
  /** A template id, e.g. `react-vite@10.6`. */
  readonly template: string;
  /** Overlay ids, applied in order after the template. */
  readonly overlays?: readonly string[];
  /** An exact Storybook version on the template's line; default: the template's pin. */
  readonly storybookVersion?: string;
}

export interface SandboxFile {
  /** POSIX path relative to the sandbox root. */
  readonly path: string;
  readonly content: string;
}

export interface SandboxManifest {
  readonly format: typeof MANIFEST_FORMAT;
  readonly name: string;
  readonly template: string;
  readonly overlays: readonly string[];
  readonly storybook: string;
  readonly framework: string;
  /** Every generated file except the manifest, sorted. */
  readonly files: readonly string[];
}

export interface SandboxPlan {
  readonly name: string;
  readonly files: readonly SandboxFile[];
  readonly manifest: SandboxManifest;
}

/** `react-vite@10.6` + `[faults]` → `react-vite-10.6-faults`. */
export function sandboxName(template: string, overlays: readonly string[] = []): string {
  return [template.replace('@', '-'), ...overlays].join('-');
}

/** The sandbox `package.json` (scripts bind the dev server to 127.0.0.1). */
export function sandboxPackageJson(template: SandboxTemplate, storybook: string, name: string): string {
  const { versions } = template;
  const manifest = {
    name: `holotype-sandbox-${name}`.replaceAll('@', '').replaceAll('.', '-'),
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: {
      storybook: 'storybook dev --port 6006 --host 127.0.0.1 --ci --no-open',
      'build-storybook': 'storybook build --output-dir storybook-static --quiet',
    },
    dependencies: {
      react: versions.react,
      'react-dom': versions.reactDom,
    },
    devDependencies: {
      [template.framework]: storybook,
      '@vitejs/plugin-react': versions.vitePluginReact,
      storybook,
      vite: versions.vite,
    },
    pnpm: { onlyBuiltDependencies: ['esbuild'] },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const toPosix = (path: string): string => path.split(sep).join('/');

async function readTree(root: string): Promise<SandboxFile[]> {
  const files: SandboxFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile())
        files.push({ path: toPosix(relative(root, path)), content: await readFile(path, 'utf8') });
    }
  };
  await walk(root);
  return files;
}

/** Reads the files of a sandbox without writing anything. Later overlays win on a path clash. */
export async function planSandbox(spec: SandboxSpec, packageRoot: string = PACKAGE_ROOT): Promise<SandboxPlan> {
  const template = findTemplate(spec.template);
  const overlays = (spec.overlays ?? []).map(checkOverlay);
  if (new Set(overlays).size !== overlays.length) throw new Error(`Overlay listed twice: ${overlays.join(', ')}.`);
  const storybook = resolveStorybookVersion(template, spec.storybookVersion);
  const name = sandboxName(template.id, overlays);

  const byPath = new Map<string, string>();
  for (const file of await readTree(join(packageRoot, 'templates', template.dir))) byPath.set(file.path, file.content);
  for (const overlay of overlays) {
    for (const file of await readTree(join(packageRoot, 'overlays', overlay))) byPath.set(file.path, file.content);
  }
  if (byPath.has('package.json') || byPath.has(MANIFEST_FILE)) {
    throw new Error(`Templates and overlays must not ship package.json or ${MANIFEST_FILE}: they are generated.`);
  }
  byPath.set('package.json', sandboxPackageJson(template, storybook, name));

  const files = [...byPath.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, content]) => ({ path, content }));
  const manifest: SandboxManifest = {
    format: MANIFEST_FORMAT,
    name,
    template: template.id,
    overlays,
    storybook,
    framework: template.framework,
    files: files.map((file) => file.path),
  };
  return { name, files, manifest };
}

export interface GenerateOptions extends SandboxSpec {
  /** Parent folder of the sandbox; default {@link DEFAULT_OUT_ROOT}. */
  readonly outRoot?: string;
  /** Overwrite an earlier sandbox in the same folder. `node_modules` is kept. */
  readonly force?: boolean;
}

export interface GeneratedSandbox extends SandboxPlan {
  /** Absolute path of the sandbox. */
  readonly dir: string;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function readManifest(dir: string): Promise<SandboxManifest | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8')) as Partial<SandboxManifest>;
    return parsed.format === MANIFEST_FORMAT && Array.isArray(parsed.files) ? (parsed as SandboxManifest) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Generates a sandbox into `<outRoot>/<name>`. Refuses to write into a folder that is not an
 * earlier sandbox, and into an earlier sandbox unless `force` is set; with `force`, the files
 * of the earlier manifest are removed first, `node_modules` and build output stay.
 */
export async function generateSandbox(options: GenerateOptions): Promise<GeneratedSandbox> {
  const plan = await planSandbox(options);
  const dir = resolve(options.outRoot ?? DEFAULT_OUT_ROOT, plan.name);
  if (await exists(dir)) {
    const previous = await readManifest(dir);
    if (previous === undefined) {
      throw new Error(`${dir} exists and is not a generated sandbox (no ${MANIFEST_FILE}); remove it or pick --out.`);
    }
    if (options.force !== true) throw new Error(`Sandbox ${dir} already exists; pass --force to regenerate it.`);
    for (const path of previous.files) await rm(join(dir, path), { force: true });
  }
  for (const file of plan.files) {
    const target = join(dir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  await writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(plan.manifest, null, 2)}\n`);
  return { ...plan, dir };
}
