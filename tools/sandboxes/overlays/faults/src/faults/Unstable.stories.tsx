import type { Meta, StoryObj } from '@storybook/react-vite';
import { Ticker } from './Probe.tsx';

/** A story whose root keeps changing size after Storybook reports it done (S-07). */
const meta = {
  title: 'Faults/Unstable',
  component: Ticker,
  args: { label: 'Ticking' },
} satisfies Meta<typeof Ticker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ticking: Story = {};
