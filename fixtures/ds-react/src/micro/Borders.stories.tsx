import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx } from '../utils/cx.ts';
import s from './borders.module.css';

/**
 * Plain-markup border cases, one feature each (BUILD B-04, 12 §2.2). Ids `micro-borders--<case>`
 * are API: never rename an export.
 */
const meta = { title: 'Micro/Borders' } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Uniform: Story = {
  render: () => <div className={cx(s.box, s.uniform)} />,
};

export const PerSideWidths: Story = {
  render: () => <div className={cx(s.box, s.perSideWidths)} />,
};

export const PerSideColors: Story = {
  render: () => <div className={cx(s.box, s.perSideColors)} />,
};

export const Dashed: Story = {
  render: () => <div className={cx(s.box, s.dashed)} />,
};

export const OutlineOffset: Story = {
  render: () => <div className={cx(s.box, s.outlineOffset)} />,
};

export const RadiusPerCorner: Story = {
  render: () => <div className={cx(s.box, s.radiusPerCorner)} />,
};

/** A child that overflows a rounded parent with `overflow: hidden` is clipped to the corners. */
export const RadiusOverflow: Story = {
  render: () => (
    <div className={cx(s.box, s.radiusOverflow)}>
      <div className={s.overflowChild} />
    </div>
  ),
};
