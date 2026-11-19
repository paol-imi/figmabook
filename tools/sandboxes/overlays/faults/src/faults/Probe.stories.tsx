import type { Meta, StoryObj } from '@storybook/react-vite';
import { Probe, probeTones } from './Probe.tsx';

/**
 * Failure injection for the render-loop spike (S-07): each story fails or slows down in one way.
 * `Healthy` is the control; the others are named after their fault.
 */
const meta = {
  title: 'Faults/Probe',
  component: Probe,
  args: { label: 'Probe', tone: 'neutral', crash: false, delayMs: 0 },
  argTypes: {
    tone: { control: 'select', options: probeTones },
    crash: { control: 'boolean' },
    delayMs: { control: 'number' },
  },
} satisfies Meta<typeof Probe>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {};

/** Throws during React render; `crash: false` makes it render again. */
export const Throws: Story = { args: { crash: true } };

/** Its loader never resolves: the render stays in the `loading` phase. */
export const NeverSettles: Story = {
  loaders: [() => new Promise<never>(() => {})],
};

/** Its loader waits `delayMs` before the story renders. */
export const SlowLoader: Story = {
  args: { delayMs: 1500 },
  loaders: [
    async ({ args }) => {
      await new Promise((resolve) => setTimeout(resolve, Number(args.delayMs ?? 0)));
      return {};
    },
  ],
};

/** Renders fine but logs a console error on every render. */
export const ConsoleError: Story = {
  render: (args) => {
    console.error(`ConsoleError story: logged on purpose (${args.label})`);
    return <Probe {...args} />;
  },
};

/** Renders fine; its play function throws. */
export const PlayFails: Story = {
  play: async () => {
    throw new Error('PlayFails story: play failed on purpose');
  },
};
