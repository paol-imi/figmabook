import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';
import { PLACEHOLDER_ID } from '../scripts/pack.mjs';

const manifest = packageJson['figma-plugin'];
const LOOPBACK_PORTS = [47321, 47322, 47323]; // D-25

describe('plugin manifest (09 §2)', () => {
  it('is the Holotype dynamic-page plugin for Figma Design (D-06)', () => {
    expect(manifest).toMatchObject({
      name: 'Holotype',
      api: '1.0.0',
      editorType: ['figma'],
      documentAccess: 'dynamic-page',
      // `figma.fileKey` for development and private organization plugins (D-39).
      enablePrivatePluginApi: true,
      main: 'src/main.ts',
      ui: 'src/ui/index.tsx',
    });
  });

  it('still carries the placeholder id: replace it with the Figma-issued id before the first release', () => {
    // When Figma issues the real id, change this test: the id is then fixed forever (02 §6.4).
    expect(manifest.id).toBe(PLACEHOLDER_ID);
  });

  it('allows exactly the loopback CLI ports over http and ws, and no wildcard (D-25, 13)', () => {
    const expected = ['http', 'ws'].flatMap((scheme) => LOOPBACK_PORTS.map((port) => `${scheme}://127.0.0.1:${port}`));
    expect(manifest.networkAccess.allowedDomains).toEqual(expected);
    expect(
      manifest.networkAccess.devAllowedDomains.every((domain) => /^(http|ws):\/\/localhost:4732[1-3]$/.test(domain)),
    ).toBe(true);
    expect(JSON.stringify(manifest.networkAccess)).not.toContain('*');
  });

  it('explains its network access to users', () => {
    expect(manifest.networkAccess.reasoning).toMatch(/127\.0\.0\.1/);
  });
});
