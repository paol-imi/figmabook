import { Container, Muted, render, Stack, Text, VerticalSpace } from '@create-figma-plugin/ui';
// biome-ignore lint/correctness/noUnusedImports: create-figma-plugin compiles JSX to the classic `h()` factory.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { version } from '../package.json';
import { isProtocolMessage, type MainToUi, PROTOCOL_VERSION, type UiToMain } from './protocol';

function post(message: UiToMain): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

function Plugin() {
  const [ready, setReady] = useState<MainToUi | null>(null);

  useEffect(() => {
    const sessionId = crypto.randomUUID();
    const onMessage = (event: MessageEvent<{ pluginMessage?: unknown }>) => {
      const message = event.data.pluginMessage;
      if (isProtocolMessage<MainToUi>(message, 'ready') && message.sessionId === sessionId) setReady(message);
    };
    window.addEventListener('message', onMessage);
    post({ v: PROTOCOL_VERSION, sessionId, t: 'hello', uiVersion: version });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <Container space="medium">
      <VerticalSpace space="large" />
      <Stack space="small">
        <Text>Holotype</Text>
        <Text>
          <Muted>
            {ready
              ? `Plugin ${ready.pluginVersion} · Scene IR ${ready.irMajors.map((major) => `v${major}`).join(', ')}`
              : 'Starting…'}
          </Muted>
        </Text>
      </Stack>
    </Container>
  );
}

export default render(Plugin);
