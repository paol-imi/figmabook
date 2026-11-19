import { main } from './main';
import { processIo } from './output/io';

// SIGINT stops the run between steps (exit 130, 11 §3.2); a second SIGINT ends the process.
const controller = new AbortController();
process.once('SIGINT', () => {
  controller.abort();
  process.once('SIGINT', () => process.exit(130));
});

process.exitCode = await main(process.argv.slice(2), processIo(controller.signal));
