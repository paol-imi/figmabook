import { rectOf } from '../css';
import type { Collector } from '../types';

/**
 * Element rects (05 §3.1, fast path): the border box from `getBoundingClientRect`, in page
 * space. Transformed nodes keep their axis-aligned box here; `unsupported` reports the
 * transform until the CDP box-model path lands (B-41, B-102).
 */
export const geometry: Collector = {
  name: 'geometry',
  element({ element }, draft) {
    draft.borderBox = rectOf(element);
  },
};
