import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx } from '../utils/cx.ts';
import s from './flex.module.css';

/**
 * Plain-markup flex cases, one feature each (BUILD B-04, 12 §2.2). Ids `micro-flex--<case>`
 * are API: never rename an export.
 */
const meta = { title: 'Micro/Flex' } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const itemNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;

/** The first `count` fixed-size boxes, each tagged with a stable `data-item` name. */
const items = (count: number) =>
  itemNames.slice(0, count).map((name) => <div key={name} className={s.item} data-item={name} />);

export const Row: Story = {
  render: () => <div className={cx(s.container, s.row)}>{items(3)}</div>,
};

export const Column: Story = {
  render: () => <div className={cx(s.container, s.column)}>{items(3)}</div>,
};

export const Wrap: Story = {
  render: () => <div className={cx(s.container, s.wrap)}>{items(7)}</div>,
};

export const Gap: Story = {
  render: () => <div className={cx(s.container, s.gap)}>{items(4)}</div>,
};

export const JustifyBetween: Story = {
  render: () => <div className={cx(s.container, s.justifyBetween)}>{items(3)}</div>,
};

export const AlignCenter: Story = {
  render: () => (
    <div className={cx(s.container, s.alignCenter)}>
      <div className={s.item} />
      <div className={s.itemTall} />
      <div className={s.item} />
    </div>
  ),
};

export const Grow: Story = {
  render: () => (
    <div className={cx(s.container, s.grow)}>
      <div className={s.item} />
      <div className={s.growItem} />
      <div className={s.item} />
    </div>
  ),
};

export const Nested: Story = {
  render: () => (
    <div className={cx(s.container, s.nested)}>
      <div className={s.nestedRow}>{items(2)}</div>
      <div className={s.nestedRow}>{items(3)}</div>
    </div>
  ),
};
