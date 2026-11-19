import type { Meta, StoryObj } from '@storybook/react-vite';
import type { HolotypeParams } from '../../holotype-params.ts';
import { Badge } from '../Badge/Badge.tsx';
import { Button } from '../Button/Button.tsx';
import { Input } from '../Input/Input.tsx';
import { Stack } from './Stack.tsx';

const wrapItems = [
  'Design',
  'Tokens',
  'Layout',
  'Variants',
  'Typography',
  'Color',
  'Spacing',
  'Icons',
  'Motion',
  'Accessibility',
  'Content',
  'Review',
];

/** Story ids are API (BUILD §2.3): never rename an export, add new ones instead. */
const meta = {
  title: 'Components/Stack',
  component: Stack,
  args: {
    direction: 'row',
    gap: 2,
    align: 'center',
    justify: 'start',
    wrap: false,
  },
  argTypes: {
    direction: { control: 'inline-radio', options: ['row', 'column'] },
    gap: { control: { type: 'range', min: 1, max: 8, step: 1 } },
    align: { control: 'select', options: ['start', 'center', 'end', 'stretch', 'baseline'] },
    justify: { control: 'select', options: ['start', 'center', 'end', 'between'] },
    wrap: { control: 'boolean' },
    children: { control: false },
  },
} satisfies Meta<typeof Stack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Row: Story = {
  args: {
    children: (
      <>
        <Button label="Save" />
        <Button variant="secondary" label="Preview" />
        <Button variant="ghost" label="Cancel" />
      </>
    ),
  },
};

export const Column: Story = {
  args: {
    direction: 'column',
    gap: 4,
    align: 'stretch',
    children: (
      <>
        <Input label="Name" placeholder="Ada" />
        <Input label="Email" placeholder="you@example.com" />
        <Button label="Create account" />
      </>
    ),
  },
};

export const Wrap: Story = {
  args: {
    wrap: true,
    children: (
      <>
        {wrapItems.map((item) => (
          <Badge key={item} label={item} tone="info" />
        ))}
      </>
    ),
  },
  parameters: {
    holotype: { keepLayout: true, width: { probe: [240, 480] } } satisfies HolotypeParams,
  },
};
