import type { Meta, StoryObj } from '@storybook/react-vite';
import { iconNames } from '../Icon/icons.ts';
import { Input } from './Input.tsx';

/** Story ids are API (BUILD §2.3): never rename an export, add new ones instead. */
const meta = {
  title: 'Components/Input',
  component: Input,
  args: {
    label: 'Email',
    placeholder: 'you@example.com',
    value: '',
    helperText: 'We never share your email.',
    disabled: false,
  },
  argTypes: {
    label: { control: 'text' },
    placeholder: { control: 'text' },
    value: { control: 'text' },
    helperText: { control: 'text' },
    error: { control: 'text' },
    disabled: { control: 'boolean' },
    prefixIcon: { control: 'select', options: iconNames },
    onValueChange: { control: false },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithError: Story = {
  args: { value: 'not-an-email', error: 'Enter a valid email address.' },
};

export const Disabled: Story = {
  args: { disabled: true, value: 'locked@example.com' },
};

export const WithPrefix: Story = {
  args: { label: 'Search', placeholder: 'Search components', helperText: '', prefixIcon: 'search' },
};
