import type { Meta, StoryObj } from '@storybook/react-vite';
import { Frame } from './Probe.tsx';

/** A React node arg (S-07): a channel update can move `Filled`'s node into `Empty`. */
const meta = {
  title: 'Faults/Slots',
  component: Frame,
  args: { title: 'Frame' },
} satisfies Meta<typeof Frame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Filled: Story = {
  args: { title: 'Filled', content: <strong data-filled="">Filled slot</strong> },
};

export const Empty: Story = {
  args: { title: 'Empty', content: null },
};
