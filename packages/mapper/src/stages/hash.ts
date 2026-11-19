import { withSceneHashes } from '@holotype/ir';
import { mapperFailure } from '../diagnostics';
import type { ComponentStage } from './types';

/** Stage 15, hashing (06 §6): every node, variant and component `irh`, bottom-up. */
export const hashStage: ComponentStage = {
  step: 15,
  name: 'hash',
  per: 'component',
  run(component) {
    if (!component.scene) throw mapperFailure(component.input.sid, 'hashing ran before emission');
    component.scene = withSceneHashes(component.scene);
  },
};
