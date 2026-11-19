import type { Meta, StoryObj } from '@storybook/react-vite';
import type { HolotypeParams } from '../../holotype-params.ts';
import { Stack } from '../Stack/Stack.tsx';
import { Badge, type BadgeTone } from './Badge.tsx';

const toneLabels: Record<BadgeTone, string> = {
  neutral: 'Neutral',
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
};
const tones = Object.keys(toneLabels) as BadgeTone[];

/** Story ids are API (BUILD §2.3): never rename an export, add new ones instead. */
const meta = {
  title: 'Components/Badge',
  component: Badge,
  args: {
    tone: 'neutral',
    label: 'Badge',
    dot: false,
  },
  argTypes: {
    tone: { control: 'select', options: tones },
    label: { control: 'text' },
    dot: { control: 'boolean' },
  },
  parameters: {
    holotype: {
      args: {
        tone: { as: 'variant', name: 'Tone' },
        dot: { as: 'boolean', name: 'Dot' },
        label: { as: 'text' },
      },
    } satisfies HolotypeParams,
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** One badge per tone, so the planner sees every `tone` value in one render. */
export const Tones: Story = {
  render: (args) => (
    <Stack direction="row" gap={2} align="center">
      {tones.map((tone) => (
        <Badge key={tone} {...args} tone={tone} label={toneLabels[tone]} />
      ))}
    </Stack>
  ),
};

export const WithDot: Story = {
  args: { dot: true, tone: 'success', label: 'Online' },
};
