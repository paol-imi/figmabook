import type { Page } from 'playwright';
import { CONTROLLER_KEY, installChannelController } from './channel-scripts';

const installed = new WeakSet<Page>();

/** Adds the channel controller init script to `page` once, whoever asks (drivers, `describe`). */
export async function ensureChannelController(page: Page): Promise<void> {
  if (installed.has(page)) return;
  installed.add(page);
  await page.addInitScript(installChannelController, CONTROLLER_KEY);
}
