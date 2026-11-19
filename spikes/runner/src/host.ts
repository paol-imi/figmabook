/**
 * Main-thread host: receives `call` messages from the UI, runs the named task with the real
 * Plugin API, and posts the result back. A task that throws becomes an error result; the
 * host itself never throws, so one failing probe cannot close the plugin.
 */
import { errorMessage } from '../../_shared/json.ts';
import type { MainContext, TaskTable, WireValue } from '../../_shared/spike.ts';
import { isCallMessage, KIT, type MainToUi } from './protocol.ts';

export function createMainHost(figma: PluginAPI, tasks: TaskTable): void {
  const post = (message: MainToUi) => figma.ui.postMessage(message);

  figma.ui.onmessage = async (message: unknown) => {
    if (!isCallMessage(message)) return;
    const { id, task, input } = message;
    const run = tasks[task];
    if (!run) {
      post({ kit: KIT, t: 'result', id, ok: false, error: `Unknown task "${task}". Is the kit up to date?` });
      return;
    }
    const ctx: MainContext = {
      figma,
      progress: (text) => post({ kit: KIT, t: 'progress', id, message: text }),
    };
    try {
      const output: WireValue = await run(ctx, input as never);
      post({ kit: KIT, t: 'result', id, ok: true, output });
    } catch (error) {
      post({ kit: KIT, t: 'result', id, ok: false, error: errorMessage(error) });
    }
  };
}
