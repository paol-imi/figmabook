import type { Meta, StoryObj } from '@storybook/react-vite';
import { Icon, type IconSize } from './Icon.tsx';
import styles from './IconGallery.module.css';
import { iconNames } from './icons.ts';

const sizes: readonly IconSize[] = [16, 20, 24];

/** Story ids are API (BUILD §2.3): never rename an export, add new ones instead. */
const meta = {
  title: 'Components/Icon',
  component: Icon,
  args: {
    name: 'star',
    size: 24,
  },
  argTypes: {
    name: { control: 'select', options: iconNames },
    size: { control: 'inline-radio', options: sizes },
    label: { control: 'text' },
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every icon with its name. Documentation only, so it opts out of Figma with `!figma`. */
export const Gallery: Story = {
  tags: ['!figma'],
  render: (args) => (
    <ul className={styles.gallery}>
      {iconNames.map((name) => (
        <li key={name} className={styles.item}>
          <Icon {...args} name={name} />
          <span className={styles.name}>{name}</span>
        </li>
      ))}
    </ul>
  ),
};
