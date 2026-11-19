import { createElement } from 'react';
import { cx } from '../../utils/cx.ts';
import styles from './Icon.module.css';
import { type IconName, icons } from './icons.ts';

export type IconSize = 16 | 20 | 24;

export interface IconProps {
  /** Which icon to draw. */
  name: IconName;
  /** Edge length in px. Mapped to the `--size-icon-*` tokens. */
  size?: IconSize;
  /** Accessible name. Without it the icon is decorative (`aria-hidden`). */
  label?: string | undefined;
  className?: string | undefined;
}

const sizeClass: Record<IconSize, string | undefined> = {
  16: styles.sm,
  20: styles.md,
  24: styles.lg,
};

/** An inline SVG icon drawn with `currentColor`, so it takes the text color of its parent. */
export function Icon({ name, size = 20, label, className }: IconProps) {
  const labelled = label !== undefined && label.length > 0;
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: titled when labelled, otherwise decorative and aria-hidden.
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx(styles.icon, sizeClass[size], className)}
      data-icon={name}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {labelled ? <title>{label}</title> : null}
      {icons[name].map(([tag, attrs], index) =>
        // Icon nodes are static and never reorder, so the index is a stable key.
        createElement(tag, { key: `${tag}-${index}`, ...attrs }),
      )}
    </svg>
  );
}
