import { cx } from '../../utils/cx.ts';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  /** Color family that carries the meaning. */
  tone?: BadgeTone;
  label: string;
  /** Shows a status dot before the label. */
  dot?: boolean;
  className?: string | undefined;
}

/** A small inline status label that hugs its content. */
export function Badge({ tone = 'neutral', label, dot = false, className }: BadgeProps) {
  return (
    <span className={cx(styles.badge, styles[tone], className)}>
      {dot ? <span className={styles.dot} aria-hidden="true" data-part="dot" /> : null}
      {label}
    </span>
  );
}
