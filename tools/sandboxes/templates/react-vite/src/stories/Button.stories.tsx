import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.tsx';

const meta = {
  title: 'Example/Button',
  component: Button,
  args: { primary: false, size: 'medium', label: 'Button' },
  argTypes: {
    size: { control: 'inline-radio', options: ['small', 'medium', 'large'] },
    backgroundColor: { control: 'color' },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { primary: true } };

export const Secondary: Story = {};

export const Large: Story = { args: { size: 'large' } };

export const Small: Story = { args: { size: 'small' } };
