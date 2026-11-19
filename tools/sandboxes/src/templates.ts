/**
 * The sandbox templates (D-26: React + Vite on Storybook 10 first). A template is a framework
 * plus one Storybook minor line; its files live in `templates/<dir>/` and its dependency
 * versions are pinned here, so a sandbox is reproducible from its id alone.
 */

/** Exact versions written into a sandbox's `package.json`. */
export interface TemplateVersions {
  readonly storybook: string;
  readonly framework: string;
  readonly react: string;
  readonly reactDom: string;
  readonly vite: string;
  readonly vitePluginReact: string;
}

export interface SandboxTemplate {
  /** `<framework>@<storybook major.minor>`, e.g. `react-vite@10.6`. */
  readonly id: string;
  /** Folder under `templates/` with the template's files. */
  readonly dir: string;
  /** The Storybook framework package. */
  readonly framework: '@storybook/react-vite';
  /** `major.minor` every accepted Storybook version must have. */
  readonly storybookLine: string;
  readonly versions: TemplateVersions;
}

/** Templates the generator can write today (the slice part of BUILD B-16). */
export const TEMPLATES: readonly SandboxTemplate[] = Object.freeze([
  {
    id: 'react-vite@10.6',
    dir: 'react-vite',
    framework: '@storybook/react-vite',
    storybookLine: '10.6',
    // Same pins as fixtures/ds-react, so an install is served from the local pnpm store.
    versions: {
      storybook: '10.6.7',
      framework: '10.6.7',
      react: '19.3.1',
      reactDom: '19.3.1',
      vite: '8.3.8',
      vitePluginReact: '6.3.0',
    },
  },
]);

/** Templates the plan asks for that are not built yet, with the work item that adds them. */
export const PLANNED_TEMPLATES: Readonly<Record<string, string>> = Object.freeze({
  'react-vite@11': 'Storybook 11 beta (docgen server, components manifest): BUILD B-140, hardening',
  'react-vite@9.1': 'Storybook 9.1 smoke cell (D-11): BUILD B-141, hardening',
  'react-vite@8.6': 'Storybook 8.6 smoke cell (D-11): BUILD B-141, hardening',
});

/** Story sets a spike adds on top of a template; files live in `overlays/<id>/`. */
export const OVERLAYS: Readonly<Record<string, string>> = Object.freeze({
  faults:
    'Failure-injection stories for the render-loop spike S-07: throws, hangs, slow loader, console errors, play failure, unstable root, React-node args',
});

export function findTemplate(id: string): SandboxTemplate {
  const template = TEMPLATES.find((candidate) => candidate.id === id);
  if (template !== undefined) return template;
  const planned = PLANNED_TEMPLATES[id];
  if (planned !== undefined) throw new Error(`Sandbox template "${id}" is not available yet: ${planned}.`);
  const known = TEMPLATES.map((candidate) => candidate.id).join(', ');
  throw new Error(`Unknown sandbox template "${id}". Available: ${known}.`);
}

export function checkOverlay(id: string): string {
  if (OVERLAYS[id] !== undefined) return id;
  throw new Error(`Unknown sandbox overlay "${id}". Available: ${Object.keys(OVERLAYS).join(', ')}.`);
}

const EXACT_SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

/**
 * The Storybook version of a sandbox: the template's pin, or an exact override on the same
 * `major.minor` line (`10.6.3` for `react-vite@10.6`). Ranges are refused: a sandbox is a
 * reproducible test subject.
 */
export function resolveStorybookVersion(template: SandboxTemplate, override?: string): string {
  if (override === undefined) return template.versions.storybook;
  const match = EXACT_SEMVER.exec(override);
  if (match === null) {
    throw new Error(`Storybook version "${override}" is not an exact version such as ${template.versions.storybook}.`);
  }
  const line = `${match[1]}.${match[2]}`;
  if (line !== template.storybookLine) {
    throw new Error(`Storybook ${override} is not on the ${template.storybookLine} line of template "${template.id}".`);
  }
  return override;
}
