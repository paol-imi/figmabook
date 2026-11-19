import { showUI } from '@create-figma-plugin/utilities';
import { SUPPORTED_SCENE_MAJORS } from '@holotype/ir/core';
import { createDiagnostic, diagnostic, HolotypeError } from '@holotype/shared';
import { version } from '../package.json';
import { createApplyId, runImportSession } from './apply/session';
import { createMainChannel, figmaUiTransport } from './channel';
import { startHost } from './host';
import type { FigmaPort } from './port';

/** Default window size (11 §5); the window is resizable later through `figma.ui.resize`. */
export const UI_SIZE = { width: 420, height: 640 } as const;

/** `setTimeout(0)` where the sandbox has it; availability is checked by S-06 (09 §12). */
const timeoutYield = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// The only module that touches the `figma` global (09 §4): everything else receives ports.
export default function main(): void {
  const port: FigmaPort = figma;
  const channel = createMainChannel(figmaUiTransport(figma.ui));
  startHost({
    channel,
    pluginVersion: version,
    irMajors: SUPPORTED_SCENE_MAJORS,
    // Needs `enablePrivatePluginApi` in the manifest (D-39); `undefined` elsewhere.
    fileKey: () => figma.fileKey ?? null,
    openSession: async (message, host) => {
      // Holotype builds components: only in a Design editor (09 §5 "Edit access").
      if (figma.editorType !== 'figma') throw new HolotypeError(createDiagnostic(diagnostic('APPLY_NO_EDIT_ACCESS')));
      await runImportSession({
        message,
        host,
        channel,
        port,
        now: () => Date.now(),
        yieldToEditor: typeof setTimeout === 'function' ? timeoutYield : () => host.uiRoundTrip(),
        createId: () => createApplyId(),
      });
    },
  });
  // `themeColors: true` is create-figma-plugin's default: the UI gets `--figma-color-*` vars.
  showUI({ ...UI_SIZE, themeColors: true, title: 'Holotype' });
}
