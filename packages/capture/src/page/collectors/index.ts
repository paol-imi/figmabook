/*
 * The collector registry (05 §3). Hot file (BUILD §2.3): one import line per collector and
 * one entry per collector, append only. Collectors run in this order for every element and
 * text block; later ones may read what earlier ones wrote (`box` and `radius` read the
 * border box from `geometry`).
 */
import type { Collector } from '../types';
import { box } from './box';
import { geometry } from './geometry';
import { background } from './paint/background';
import { border } from './paint/border';
import { effects } from './paint/effects';
import { opacity } from './paint/opacity';
import { radius } from './paint/radius';
import { paintOrder } from './paint-order';
import { text } from './text';
import { unsupported } from './unsupported';

export const collectors: readonly Collector[] = [
  geometry,
  box,
  background,
  border,
  radius,
  opacity,
  effects,
  paintOrder,
  text,
  unsupported,
];
