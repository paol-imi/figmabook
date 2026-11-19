import { describe, expect, it } from 'vitest';
import { checkStorybookVersion, detectCapabilities, parseProjectJson, parseSemver } from '../src';
import { readFixtureJson } from './support';

describe('parseProjectJson', () => {
  it('reads the recorded Storybook 10 project.json', () => {
    expect(parseProjectJson(readFixtureJson('sb10-ds-react', 'project.json'))).toEqual({
      storybookVersion: '10.6.7',
      framework: '@storybook/react-vite',
      renderer: '@storybook/react',
      builder: 'vite',
    });
  });

  it('accepts a string framework and keeps unknown builders as their package name', () => {
    expect(parseProjectJson({ framework: '@storybook/vue3-vite', builder: '@acme/builder' })).toEqual({
      framework: '@storybook/vue3-vite',
      builder: '@acme/builder',
    });
    expect(parseProjectJson({ builder: '@storybook/builder-webpack5' })).toEqual({ builder: 'webpack5' });
  });

  it.each([null, 'text', 42, { storybookVersion: 10 }])('gives {} for %j', (json) => {
    expect(parseProjectJson(json)).toEqual({});
  });
});

describe('parseSemver', () => {
  it.each([
    ['10.6.7', { major: 10, minor: 6, patch: 7 }],
    ['11.0.0-beta.3', { major: 11, minor: 0, patch: 0 }],
    ['v9.1', { major: 9, minor: 1, patch: 0 }],
    ['8', { major: 8, minor: 0, patch: 0 }],
  ])('%s', (version, expected) => {
    expect(parseSemver(version)).toEqual(expected);
  });

  it('gives undefined for a non-version', () => {
    expect(parseSemver('next')).toBeUndefined();
  });
});

describe('detectCapabilities', () => {
  it('turns on every 10.x flag for the recorded build', () => {
    const project = parseProjectJson(readFixtureJson('sb10-ds-react', 'project.json'));
    expect(detectCapabilities('v5', project)).toEqual({
      version: '10.6.7',
      indexFormat: 'v5',
      storyFinishedEvent: true,
      awaitsAnimations: true,
      pauseAnimationsInTestRunner: true,
      docgenServer: false,
      componentsManifest: true,
      argTypesInfoEvent: true,
      storyGlobals: true,
      pseudoStatesGlobal: true,
      framework: '@storybook/react-vite',
      renderer: '@storybook/react',
      builder: 'vite',
    });
  });

  it('follows the version line by line', () => {
    const flags = (version: string) => detectCapabilities('v5', { storybookVersion: version });
    expect(flags('8.1.0')).toMatchObject({ storyFinishedEvent: false, storyGlobals: false, awaitsAnimations: false });
    expect(flags('8.6.19')).toMatchObject({ storyFinishedEvent: true, awaitsAnimations: false });
    expect(flags('9.0.0')).toMatchObject({ awaitsAnimations: true, pauseAnimationsInTestRunner: false });
    expect(flags('10.0.0')).toMatchObject({ argTypesInfoEvent: true, componentsManifest: false });
    expect(flags('11.0.0-beta.3')).toMatchObject({ docgenServer: true });
  });

  it('is conservative without project.json: storyRendered is the done event', () => {
    expect(detectCapabilities('v5', {})).toMatchObject({ version: null, storyFinishedEvent: false });
    expect(detectCapabilities('v4', {})).toMatchObject({ version: null, storyGlobals: false });
  });
});

describe('checkStorybookVersion', () => {
  const caps = (version: string | null, format: 'v3' | 'v4' | 'v5' = 'v5') =>
    detectCapabilities(format, version === null ? {} : { storybookVersion: version });

  it('passes Storybook 8, 9 and 10 silently', () => {
    for (const version of ['8.6.19', '9.1.21', '10.6.7'])
      expect(checkStorybookVersion(caps(version))).toEqual({ warnings: [] });
  });

  it('passes an unknown version read from index.json', () => {
    expect(checkStorybookVersion(caps(null))).toEqual({ warnings: [] });
  });

  it('stops on Storybook 7 with SB_VERSION_UNSUPPORTED', () => {
    const { fatal } = checkStorybookVersion(caps('7.6.24', 'v4'));
    expect(fatal).toMatchObject({
      code: 'SB_VERSION_UNSUPPORTED',
      severity: 'fatal',
      message: 'Storybook 7.6.24 is not supported; Holotype needs Storybook 8 or newer.',
      value: '7.6.24',
      data: { fatal: true, oldestSupportedMajor: 8 },
    });
  });

  it('stops on a v3 stories.json without project.json', () => {
    expect(checkStorybookVersion(caps(null, 'v3')).fatal?.code).toBe('SB_VERSION_UNSUPPORTED');
  });

  it('warns SB_VERSION_UNTESTED on a newer major', () => {
    const { fatal, warnings } = checkStorybookVersion(caps('11.0.0-beta.3'));
    expect(fatal).toBeUndefined();
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'SB_VERSION_UNTESTED',
        severity: 'warn',
        value: '11.0.0-beta.3',
        fallback: 'the Storybook 10 adapter',
      }),
    ]);
  });
});
