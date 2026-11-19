import { defineCommand, runMain } from 'citty';
import { description, version } from '../package.json';

const main = defineCommand({
  meta: { name: 'holotype', version, description },
  subCommands: {},
});

await runMain(main);
