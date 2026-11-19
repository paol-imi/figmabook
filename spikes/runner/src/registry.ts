/** The spikes listed in the window, in the order of BUILD §9.4 (slice-gating cards). */
import type { SpikeDefinition } from '../../_shared/spike.ts';
import { s02 } from '../../S-02/steps.ts';
import { s05 } from '../../S-05/steps.ts';
import { s06 } from '../../S-06/steps.ts';
import { s12 } from '../../S-12/steps.ts';
import { s16 } from '../../S-16/steps.ts';
import { s17 } from '../../S-17/steps.ts';

export const spikes: readonly SpikeDefinition[] = [s02, s05, s06, s12, s16, s17];
