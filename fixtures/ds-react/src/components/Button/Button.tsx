import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../../utils/cx.ts';
import { Icon } from '../Icon/Icon.tsx';
import type { IconName } from '../Icon/icons.ts';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Visual emphasis. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** The visible text. */
  label: string;
  disabled?: boolean;
  /** Shows a spinner in place of the icon, and blocks clicks. */
  loading?: boolean;
  /** The icon drawn before the label while `showIcon` is on. */
  iconLeading?: IconName;
  /** Whether the leading icon is visible. */
  showIcon?: boolean;
}

const iconSize = { sm: 16, md: 16, lg: 20 } as const;

/** The primary action control. */
export function Button({
  variant = 'primary',
  size = 'md',
  label,
  disabled = false,
  loading = false,
  iconLeading = 'plus',
  showIcon = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx(styles.button, styles[variant], styles[size], loading && styles.loading, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" data-part="spinner" />
      ) : showIcon ? (
        <Icon name={iconLeading} size={iconSize[size]} />
      ) : null}
      <span className={styles.label}>{label}</span>
    </button>
  );
}
