/** UI iframe entry: wires the bridge to `parent.postMessage` and renders the app. */
import { render } from 'preact';
import { version } from '../../../package.json';
import { createBridge, iframePort } from '../bridge.ts';
import { spikes } from '../registry.ts';
import { App } from './App.tsx';
import { styles } from './styles.ts';

const style = document.createElement('style');
style.textContent = styles;
document.head.appendChild(style);

const root = document.getElementById('app') ?? document.body;
render(
  <App
    spikes={spikes}
    bridge={createBridge(iframePort(window))}
    kitVersion={version}
    userAgent={navigator.userAgent}
  />,
  root,
);
