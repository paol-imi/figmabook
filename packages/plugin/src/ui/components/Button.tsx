// biome-ignore lint/correctness/noUnusedImports: create-figma-plugin compiles JSX to the classic `h()` factory.
import { type ComponentChildren, h } from 'preact';
import styles from './Button.module.css';

export interface ButtonProps {
  readonly children: ComponentChildren;
  readonly onClick: () => void;
  readonly variant?: 'primary' | 'secondary';
  readonly disabled?: boolean;
}

/** A Figma UI3-style button with a visible keyboard focus ring. */
export function Button({ children, onClick, variant = 'secondary', disabled = false }: ButtonProps) {
  return (
    <button type="button" class={`${styles.button} ${styles[variant]}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
