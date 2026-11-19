import './button.css';

export interface ButtonProps {
  /** Is this the principal call to action on the page? */
  primary?: boolean;
  backgroundColor?: string;
  size?: 'small' | 'medium' | 'large';
  label: string;
  onClick?: () => void;
}

/** The Storybook sandbox button: the component every generated sandbox starts with. */
export function Button({ primary = false, size = 'medium', backgroundColor, label, ...props }: ButtonProps) {
  const mode = primary ? 'sandbox-button--primary' : 'sandbox-button--secondary';
  return (
    <button
      type="button"
      className={['sandbox-button', `sandbox-button--${size}`, mode].join(' ')}
      style={backgroundColor === undefined ? undefined : { backgroundColor }}
      {...props}
    >
      {label}
    </button>
  );
}
