import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx } from '../utils/cx.ts';
import s from './backgrounds.module.css';

/**
 * Plain-markup background cases, one feature each (BUILD B-04, 12 §2.2).
 * Ids `micro-backgrounds--<case>` are API: never rename an export.
 */
const meta = { title: 'Micro/Backgrounds' } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SolidAlpha: Story = {
  render: () => <div className={cx(s.box, s.solidAlpha)} />,
};

export const Oklch: Story = {
  render: () => <div className={cx(s.box, s.oklch)} />,
};

export const LinearAngle: Story = {
  render: () => <div className={cx(s.box, s.linearAngle)} />,
};

export const LinearHardStops: Story = {
  render: () => <div className={cx(s.box, s.linearHardStops)} />,
};

export const Radial: Story = {
  render: () => <div className={cx(s.box, s.radial)} />,
};

export const Conic: Story = {
  render: () => <div className={cx(s.box, s.conic)} />,
};

export const MultiLayer: Story = {
  render: () => <div className={cx(s.box, s.multiLayer)} />,
};

export const ImageCover: Story = {
  render: () => <div className={cx(s.box, s.imageCover)} />,
};
