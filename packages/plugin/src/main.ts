import { showUI } from '@create-figma-plugin/utilities';
import { SUPPORTED_SCENE_MAJORS } from '@holotype/ir';
import packageJson from '../package.json';
import { isProtocolMessage, type MainToUi, PROTOCOL_VERSION, type UiToMain } from './protocol';

// The only module that touches the `figma` global: the applier receives a `FigmaPort`.
export default function main(): void {
  figma.ui.onmessage = (message: unknown) => {
    if (!isProtocolMessage<UiToMain>(message, 'hello')) return;
    const ready: MainToUi = {
      v: PROTOCOL_VERSION,
      sessionId: message.sessionId,
      t: 'ready',
      pluginVersion: packageJson.version,
      irMajors: SUPPORTED_SCENE_MAJORS,
      fileKey: figma.fileKey ?? null,
    };
    figma.ui.postMessage(ready);
  };
  showUI({ width: 420, height: 640 });
}
