import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx } from '../utils/cx.ts';
import s from './text.module.css';

/**
 * Plain-markup text cases, one feature each (BUILD B-04, 12 §2.2). Ids `micro-text--<case>`
 * are API: never rename an export.
 */
const meta = { title: 'Micro/Text' } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const paragraph =
  'Holotype turns Storybook stories into native Figma components. Text wraps at the container ' +
  'width, and the line count must match the browser.';

export const SingleLine: Story = {
  render: () => <p className={cx(s.text, s.singleLine)}>The quick brown fox jumps over the lazy dog</p>,
};

export const WrapParagraph: Story = {
  render: () => <p className={cx(s.text, s.paragraph)}>{paragraph}</p>,
};

export const Weights: Story = {
  render: () => (
    <div className={cx(s.text, s.weights)}>
      <span className={s.w400}>Regular 400</span>
      <span className={s.w500}>Medium 500</span>
      <span className={s.w600}>Semibold 600</span>
      <span className={s.w700}>Bold 700</span>
    </div>
  ),
};

export const LineHeightPx: Story = {
  render: () => <p className={cx(s.text, s.lineHeightPx)}>{paragraph}</p>,
};

export const LetterSpacing: Story = {
  render: () => <p className={cx(s.text, s.letterSpacing)}>Tracking 0.08em on every glyph</p>,
};

export const TextTransform: Story = {
  render: () => (
    <div className={cx(s.text, s.transforms)}>
      <span className={s.uppercase}>Upper case text</span>
      <span className={s.lowercase}>Lower Case Text</span>
      <span className={s.capitalize}>capitalized words here</span>
    </div>
  ),
};

export const MixedInline: Story = {
  render: () => (
    <p className={cx(s.text, s.mixedInline)}>
      Plain text, <strong>bold text</strong>, <span className={s.accent}>accent color</span>,{' '}
      <mark className={s.mark}>highlighted</mark> and <span className={s.small}>smaller medium</span> in one paragraph.
    </p>
  ),
};
