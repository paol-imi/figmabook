import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateSandbox, MANIFEST_FILE, planSandbox, sandboxName, sandboxPackageJson } from '../src/generate.ts';
import { findTemplate, resolveStorybookVersion, TEMPLATES } from '../src/templates.ts';

let outRoot: string;

beforeEach(async () => {
  outRoot = await mkdtemp(join(tmpdir(), 'holotype-sandboxes-'));
});

afterEach(async () => {
  await rm(outRoot, { recursive: true, force: true });
});

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe('templates', () => {
  it('has react-vite on Storybook 10.6 pinned to exact versions', () => {
    const template = findTemplate('react-vite@10.6');
    expect(template.framework).toBe('@storybook/react-vite');
    for (const version of Object.values(template.versions)) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(TEMPLATES.map((candidate) => candidate.id)).toEqual(['react-vite@10.6']);
  });

  it('names the work item of a planned template and lists the known ones for a typo', () => {
    expect(() => findTemplate('react-vite@11')).toThrow(/not available yet: .*B-140/);
    expect(() => findTemplate('react-vite@8.6')).toThrow(/B-141/);
    expect(() => findTemplate('vue-vite@10.6')).toThrow(
      /Unknown sandbox template "vue-vite@10.6". Available: react-vite@10.6/,
    );
  });

  it('accepts an exact Storybook version on the template line only', () => {
    const template = findTemplate('react-vite@10.6');
    expect(resolveStorybookVersion(template)).toBe('10.6.7');
    expect(resolveStorybookVersion(template, '10.6.2')).toBe('10.6.2');
    expect(() => resolveStorybookVersion(template, '10.7.0')).toThrow(/not on the 10.6 line/);
    expect(() => resolveStorybookVersion(template, '^10.6.0')).toThrow(/not an exact version/);
  });
});

describe('planSandbox', () => {
  it('lists the template files, the overlay and a generated package.json, sorted', async () => {
    const plan = await planSandbox({ template: 'react-vite@10.6', overlays: ['faults'] });
    expect(plan.name).toBe('react-vite-10.6-faults');
    expect(plan.manifest.files).toEqual([
      '.storybook/main.ts',
      '.storybook/preview.ts',
      'package.json',
      'src/faults/Probe.stories.tsx',
      'src/faults/Probe.tsx',
      'src/faults/Slots.stories.tsx',
      'src/faults/Unstable.stories.tsx',
      'src/faults/probe.css',
      'src/stories/Button.stories.tsx',
      'src/stories/Button.tsx',
      'src/stories/button.css',
      'tsconfig.json',
      'vite.config.ts',
    ]);
    expect(plan.manifest).toMatchObject({ template: 'react-vite@10.6', overlays: ['faults'], storybook: '10.6.7' });
  });

  it('is deterministic', async () => {
    const spec = { template: 'react-vite@10.6', overlays: ['faults'] };
    expect(await planSandbox(spec)).toEqual(await planSandbox(spec));
  });

  it('rejects unknown and repeated overlays', async () => {
    await expect(planSandbox({ template: 'react-vite@10.6', overlays: ['nope'] })).rejects.toThrow(
      /Unknown sandbox overlay "nope"/,
    );
    await expect(planSandbox({ template: 'react-vite@10.6', overlays: ['faults', 'faults'] })).rejects.toThrow(
      /listed twice/,
    );
  });
});

describe('sandboxPackageJson', () => {
  it('pins Storybook, the framework and React, and binds the dev server to 127.0.0.1', () => {
    const json = JSON.parse(sandboxPackageJson(findTemplate('react-vite@10.6'), '10.6.7', 'react-vite-10.6-faults'));
    expect(json).toEqual({
      name: 'holotype-sandbox-react-vite-10-6-faults',
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        storybook: 'storybook dev --port 6006 --host 127.0.0.1 --ci --no-open',
        'build-storybook': 'storybook build --output-dir storybook-static --quiet',
      },
      dependencies: { react: '19.3.1', 'react-dom': '19.3.1' },
      devDependencies: {
        '@storybook/react-vite': '10.6.7',
        '@vitejs/plugin-react': '6.3.0',
        storybook: '10.6.7',
        vite: '8.3.8',
      },
      pnpm: { onlyBuiltDependencies: ['esbuild'] },
    });
  });

  it('names sandboxes after template and overlays', () => {
    expect(sandboxName('react-vite@10.6')).toBe('react-vite-10.6');
    expect(sandboxName('react-vite@10.6', ['faults'])).toBe('react-vite-10.6-faults');
  });
});

describe('generateSandbox', () => {
  it('writes the files and the manifest', async () => {
    const sandbox = await generateSandbox({ template: 'react-vite@10.6', outRoot });
    expect(sandbox.dir).toBe(join(outRoot, 'react-vite-10.6'));
    const manifest = JSON.parse(await readFile(join(sandbox.dir, MANIFEST_FILE), 'utf8'));
    expect(manifest).toEqual(sandbox.manifest);
    expect(await readFile(join(sandbox.dir, 'src/stories/Button.stories.tsx'), 'utf8')).toContain(
      "title: 'Example/Button'",
    );
    expect(await exists(join(sandbox.dir, 'src/faults'))).toBe(false);
  });

  it('refuses to overwrite a sandbox without force, and a folder that is not a sandbox at all', async () => {
    await generateSandbox({ template: 'react-vite@10.6', outRoot });
    await expect(generateSandbox({ template: 'react-vite@10.6', outRoot })).rejects.toThrow(/--force/);

    const foreign = join(outRoot, 'react-vite-10.6-faults');
    await mkdir(foreign);
    await expect(
      generateSandbox({ template: 'react-vite@10.6', overlays: ['faults'], outRoot, force: true }),
    ).rejects.toThrow(/is not a generated sandbox/);
  });

  it('with force, replaces the files of the earlier manifest and keeps node_modules', async () => {
    const first = await generateSandbox({ template: 'react-vite@10.6', outRoot });
    await writeFile(join(first.dir, 'src/stories/button.css'), 'edited');
    await mkdir(join(first.dir, 'node_modules'));
    await writeFile(join(first.dir, 'node_modules/kept.txt'), 'kept');
    await generateSandbox({ template: 'react-vite@10.6', outRoot, force: true });
    expect(await readFile(join(first.dir, 'src/stories/button.css'), 'utf8')).toContain('.sandbox-button');
    expect(await readFile(join(first.dir, 'node_modules/kept.txt'), 'utf8')).toBe('kept');
  });
});
