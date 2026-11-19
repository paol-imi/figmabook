import type { Meta, StoryObj } from '@storybook/react-vite';
import type { HolotypeParams } from '../../holotype-params.ts';
import { iconNames } from '../Icon/icons.ts';
import { Button } from './Button.tsx';

/** Story ids are API (BUILD §2.3): never rename an export, add new ones instead. */
const meta = {
  title: 'Components/Button',
  component: Button,
  args: {
    variant: 'primary',
    size: 'md',
    label: 'Button',
    disabled: false,
    loading: false,
    iconLeading: 'plus',
    showIcon: false,
  },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    label: { control: 'text' },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
    iconLeading: { control: 'select', options: iconNames },
    showIcon: { control: 'boolean' },
  },
  parameters: {
    holotype: {
      args: {
        variant: { as: 'variant' },
        size: { as: 'variant' },
        label: { as: 'text' },
        showIcon: { as: 'boolean' },
      },
      // States are hardening: the slice planner reads and ignores them (PLAN_FEATURE_DOWNGRADED).
      states: { include: ['default', 'hover', 'focus-visible', 'active'], foldBooleans: ['disabled', 'loading'] },
      layout: { columns: ['Size'], rows: ['Variant'] },
    } satisfies HolotypeParams,
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = {
  args: { variant: 'secondary' },
};

export const Ghost: Story = {
  args: { variant: 'ghost' },
};

export const Small: Story = {
  args: { size: 'sm' },
};

export const Large: Story = {
  args: { size: 'lg' },
};

export const WithIcon: Story = {
  args: { showIcon: true, iconLeading: 'plus', label: 'Add item' },
};

export const Loading: Story = {
  args: { loading: true, label: 'Saving' },
};

export const Disabled: Story = {
  args: { disabled: true },
};
