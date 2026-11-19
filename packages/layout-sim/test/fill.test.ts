import { describe, expect, it } from 'vitest';
import { type FillBounds, shareFill } from '../src/fill';

const open: FillBounds = { lo: 0, hi: Number.POSITIVE_INFINITY };

describe('shareFill', () => {
  it.each([
    { name: 'no items', free: 10, items: [], sizes: [], clamped: false, starved: false },
    { name: 'one item takes everything', free: 10, items: [open], sizes: [10], clamped: false, starved: false },
    { name: 'equal shares', free: 90, items: [open, open, open], sizes: [30, 30, 30], clamped: false, starved: false },
    { name: 'no free space', free: 0, items: [open, open], sizes: [0, 0], clamped: false, starved: false },
    {
      name: 'negative free space gives 0',
      free: -10,
      items: [open, open],
      sizes: [0, 0],
      clamped: false,
      starved: true,
    },
    {
      name: 'a max violation freezes that item, the rest grow',
      free: 100,
      items: [{ lo: 0, hi: 20 }, open],
      sizes: [20, 80],
      clamped: true,
      starved: false,
    },
    {
      name: 'a min violation freezes that item, the rest shrink',
      free: 100,
      items: [{ lo: 70, hi: Number.POSITIVE_INFINITY }, open, open],
      sizes: [70, 15, 15],
      clamped: true,
      starved: false,
    },
    {
      name: 'a min that exceeds the space starves the others',
      free: 50,
      items: [{ lo: 80, hi: Number.POSITIVE_INFINITY }, open],
      sizes: [80, 0],
      clamped: true,
      starved: true,
    },
    {
      name: 'min and max violations that cancel out freeze both',
      free: 60,
      items: [
        { lo: 40, hi: Number.POSITIVE_INFINITY },
        { lo: 0, hi: 20 },
      ],
      sizes: [40, 20],
      clamped: true,
      starved: false,
    },
    {
      name: 'freezing cascades over several rounds',
      free: 100,
      items: [{ lo: 0, hi: 10 }, { lo: 0, hi: 40 }, open],
      sizes: [10, 40, 50],
      clamped: true,
      starved: false,
    },
    {
      name: 'every item at its max leaves space unused',
      free: 100,
      items: [
        { lo: 0, hi: 10 },
        { lo: 0, hi: 10 },
      ],
      sizes: [10, 10],
      clamped: true,
      starved: false,
    },
  ])('$name', ({ free, items, sizes, clamped, starved }) => {
    expect(shareFill(free, items)).toEqual({ sizes, clamped, starved });
  });
});
