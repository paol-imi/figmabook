import type { Meta, StoryObj } from '@storybook/react-vite';
import landscapeUrl from '../../assets/landscape.png';
import type { HolotypeParams } from '../../holotype-params.ts';
import { Button } from '../Button/Button.tsx';
import { Card } from './Card.tsx';

/** Named choices for the `media` arg, so the control and the planner see a finite set. */
const mediaOptions = { None: undefined, Landscape: landscapeUrl } as const;

/** Named choices for the `children` (actions) slot. */
const actionOptions = {
  None: undefined,
  Single: <Button label="Open" />,
  Pair: (
    <>
      <Button label="Open" />
      <Button variant="ghost" label="Share" />
    </>
  ),
} as const;

/** Story ids are API (BUILD §2.3): never rename an export, add new ones instead. */
const meta = {
  title: 'Components/Card',
  component: Card,
  args: {
    title: 'Mountain retreat',
    body: 'A quiet cabin above the tree line, two hours from the city.',
    // Keys of the `mapping` tables below; Storybook maps them to the real values.
    media: 'None',
    children: 'Pair',
  },
  argTypes: {
    title: { control: 'text' },
    body: { control: 'text' },
    media: { control: 'select', options: Object.keys(mediaOptions), mapping: mediaOptions },
    children: { control: 'select', options: Object.keys(actionOptions), mapping: actionOptions },
  },
  parameters: {
    holotype: {
      slots: { actions: { selector: '[data-slot=actions]' } },
    } satisfies HolotypeParams,
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithMedia: Story = {
  args: { media: 'Landscape' },
};

export const LongText: Story = {
  args: {
    title: 'A very long card title that wraps onto a second line',
    body:
      'Body copy that is far longer than three lines, so the line clamp cuts it off with an ellipsis. ' +
      'It keeps going to make sure the clamp, not the card height, decides where the text ends. ' +
      'Designers can still edit the text in Figma; the line count stays locked.',
  },
  parameters: {
    holotype: { textMode: 'locked-lines' } satisfies HolotypeParams,
  },
};
