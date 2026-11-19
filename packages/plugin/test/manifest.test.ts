import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';

const manifest = packageJson['figma-plugin'];
const LOOPBACK_PORTS = [47321, 47322, 47323]; // D-25

describe('plugin manifest (09 §2)', () => {
  it('is the Holotype dynamic-page plugin for Figma Design (D-06)', () => {
    expect(manifest).toMatchObject({
      name: 'Holotype',
      editorType: ['figma'],
      documentAccess: 'dynamic-page',
      // `figma.fileKey` for development and private organization plugins (D-39).
      enablePrivatePluginApi: true,
    });
  });

  it('allows exactly the loopback CLI ports over http and ws, and no wildcard (D-25, 13)', () => {
    const expected = ['http', 'ws'].flatMap((scheme) => LOOPBACK_PORTS.map((port) => `${scheme}://127.0.0.1:${port}`));
    expect(manifest.networkAccess.allowedDomains).toEqual(expected);
    expect(
      manifest.networkAccess.devAllowedDomains.every((domain) => /^(http|ws):\/\/localhost:4732[1-3]$/.test(domain)),
    ).toBe(true);
  });

  it('explains its network access to users', () => {
    expect(manifest.networkAccess.reasoning).toMatch(/127\.0\.0\.1/);
  });
});
