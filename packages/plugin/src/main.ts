import { showUI } from '@create-figma-plugin/utilities';
import { SUPPORTED_SCENE_MAJORS } from '@holotype/ir/core';
import { version } from '../package.json';
import { createMainChannel, figmaUiTransport } from './channel';
import { startHost } from './host';

/** Default window size (11 §5); the window is resizable later through `figma.ui.resize`. */
export const UI_SIZE = { width: 420, height: 640 } as const;

// The only module that touches the `figma` global (09 §4): everything else receives ports.
export default function main(): void {
  const channel = createMainChannel(figmaUiTransport(figma.ui));
  startHost({
    channel,
    pluginVersion: version,
    irMajors: SUPPORTED_SCENE_MAJORS,
    // Needs `enablePrivatePluginApi` in the manifest (D-39); `undefined` elsewhere.
    fileKey: () => figma.fileKey ?? null,
  });
  // `themeColors: true` is create-figma-plugin's default: the UI gets `--figma-color-*` vars.
  showUI({ ...UI_SIZE, themeColors: true, title: 'Holotype' });
}
