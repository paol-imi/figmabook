/** Every main task of the kit, keyed `kit/*` or `S-xx/*`. Bundled into `build/main.js` only. */
import type { TaskTable } from '../../_shared/spike.ts';
import { s02Tasks } from '../../S-02/plugin.ts';
import { s05Tasks } from '../../S-05/plugin.ts';
import { s06Tasks } from '../../S-06/plugin.ts';
import { s12Tasks } from '../../S-12/plugin.ts';
import { s16Tasks } from '../../S-16/plugin.ts';
import { s17Tasks } from '../../S-17/plugin.ts';
import { kitTasks } from './kit-tasks.ts';

export const allTasks = {
  ...kitTasks,
  ...s02Tasks,
  ...s05Tasks,
  ...s06Tasks,
  ...s12Tasks,
  ...s16Tasks,
  ...s17Tasks,
} satisfies TaskTable;
