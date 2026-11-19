import type { Collector } from '../../types';

const isSet = (value: string): boolean => value !== '' && value !== 'none';

/**
 * Effects. Raw facts the IR keeps as CSS text (06 §2.1): `filter`, `backdrop-filter`,
 * `clip-path` and `mask-image`, present only when set. Parsing them into structured facts,
 * and the mapper's raster or approximation decisions, come with hardening (B-101).
 */
export const effects: Collector = {
  name: 'effects',
  element({ style }, draft) {
    const { computed } = draft;
    // Box shadows are not parsed yet (B-42): the list stays empty and `unsupported` reports a set one.
    computed.boxShadow = [];
    if (isSet(style.filter)) computed.filter = style.filter;
    if (isSet(style.backdropFilter)) computed.backdropFilter = style.backdropFilter;
    if (isSet(style.clipPath)) computed.clipPath = style.clipPath;
    if (isSet(style.maskImage)) computed.maskImage = style.maskImage;
  },
};
