import type { Collector } from '../../types';

/**
 * `opacity` (05 §3 step 4): kept as computed, `0` included; the mapper decides what a fully
 * transparent node becomes.
 */
export const opacity: Collector = {
  name: 'opacity',
  element({ style }, draft) {
    const value = Number(style.opacity);
    draft.computed.opacity = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  },
};
