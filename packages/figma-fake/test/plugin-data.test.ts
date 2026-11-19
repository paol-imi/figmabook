import { describe, expect, it } from 'vitest';
import { createFakeFigma, PLUGIN_DATA_LIMIT } from '../src';

describe('shared plugin data (typings:6540-6579, 10 §2)', () => {
  it('stores strings per namespace and key; missing reads are empty strings', () => {
    const node = createFakeFigma().createFrame();
    node.setSharedPluginData('holotype', 'nk', 'root');
    node.setSharedPluginData('holotype', 'vk', 'v1');
    node.setSharedPluginData('another', 'nk', 'x');
    expect(node.getSharedPluginData('holotype', 'nk')).toBe('root');
    expect(node.getSharedPluginData('holotype', 'missing')).toBe('');
    expect(node.getSharedPluginDataKeys('holotype')).toEqual(['nk', 'vk']);
    expect(node.getSharedPluginDataKeys('nobody')).toEqual([]);
  });

  it('setting the empty string removes the key', () => {
    const node = createFakeFigma().createFrame();
    node.setSharedPluginData('holotype', 'nk', 'root');
    node.setSharedPluginData('holotype', 'nk', '');
    expect(node.getSharedPluginDataKeys('holotype')).toEqual([]);
  });

  it('namespaces need at least 3 alphanumeric characters (typings:6553-6556)', () => {
    const node = createFakeFigma().createFrame();
    expect(() => node.setSharedPluginData('ab', 'k', 'v')).toThrow(/namespace/);
    expect(() => node.setSharedPluginData('holo-type', 'k', 'v')).toThrow(/namespace/);
    expect(() => node.getSharedPluginData('', 'k')).toThrow(/namespace/);
    expect(() => node.setSharedPluginData('abc', 'k', 'v')).not.toThrow();
  });

  it('values must be strings', () => {
    const node = createFakeFigma().createFrame();
    expect(() => node.setSharedPluginData('holotype', 'n', 1 as unknown as string)).toThrow(/string/);
  });

  it('an entry (namespace + key + value) is limited to 100 kB (typings:6557-6560)', () => {
    const node = createFakeFigma().createFrame();
    const fits = 'x'.repeat(PLUGIN_DATA_LIMIT - 'holotype'.length - 'k'.length);
    node.setSharedPluginData('holotype', 'k', fits);
    expect(node.getSharedPluginData('holotype', 'k')).toHaveLength(fits.length);
    expect(() => node.setSharedPluginData('holotype', 'k', `${fits}x`)).toThrow(/too large/);
    expect(() => node.setSharedPluginData('holotype', 'k', 'é'.repeat(PLUGIN_DATA_LIMIT / 2))).toThrow(/too large/);
    expect(node.getSharedPluginData('holotype', 'k')).toHaveLength(fits.length);
  });

  it('works on the document and pages too (the root registry, 10 §2.3)', () => {
    const figma = createFakeFigma();
    figma.root.setSharedPluginData('holotype', 'registry:meta', '{"v":1}');
    figma.currentPage.setSharedPluginData('holotype', 'p', '1');
    expect(figma.root.getSharedPluginData('holotype', 'registry:meta')).toBe('{"v":1}');
    expect(figma.currentPage.getSharedPluginDataKeys('holotype')).toEqual(['p']);
  });
});

describe('private plugin data (typings:6524-6539)', () => {
  it('is separate from shared data and limited the same way, counting the plugin id', () => {
    const node = createFakeFigma({ pluginId: 'p1' }).createFrame();
    node.setPluginData('k', 'v');
    expect(node.getPluginData('k')).toBe('v');
    expect(node.getSharedPluginDataKeys('holotype')).toEqual([]);
    expect(node.getPluginDataKeys()).toEqual(['k']);
    node.setPluginData('k', '');
    expect(node.getPluginDataKeys()).toEqual([]);
    expect(() => node.setPluginData('k', 'x'.repeat(PLUGIN_DATA_LIMIT - 2))).toThrow(/too large/);
  });
});

describe('relaunch data (typings:6429-6452)', () => {
  it('replaces all relaunch data on each call and limits descriptions to 1000 characters', () => {
    const node = createFakeFigma().createComponent();
    node.setRelaunchData({ edit: 'Edit', open: '' });
    node.setRelaunchData({ open: 'Open' });
    expect(node.getRelaunchData()).toEqual({ open: 'Open' });
    expect(() => node.setRelaunchData({ edit: 'x'.repeat(1001) })).toThrow(/1000/);
  });
});
