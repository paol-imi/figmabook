import { render } from '@create-figma-plugin/ui';
// biome-ignore lint/correctness/noUnusedImports: create-figma-plugin compiles JSX to the classic `h()` factory.
import { h } from 'preact';
import { version } from '../../package.json';
import { createSessionId, createUiChannel, windowTransport } from '../channel';
import { App } from './App';

// One channel per UI load: a reloaded window starts a new session (09 §3.2).
const channel = createUiChannel(windowTransport(window), createSessionId());

function Plugin() {
  return <App channel={channel} uiVersion={version} />;
}

export default render(Plugin);
