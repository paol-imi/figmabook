import { type ChangeEvent, type InputHTMLAttributes, useId, useState } from 'react';
import { cx } from '../../utils/cx.ts';
import { Icon } from '../Icon/Icon.tsx';
import type { IconName } from '../Icon/icons.ts';
import styles from './Input.module.css';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'prefix'> {
  /** The visible field label. */
  label: string;
  placeholder?: string;
  /** The field value. The field stays editable and follows later changes of this prop. */
  value?: string;
  /** Called with the new text on every edit. */
  onValueChange?: (value: string) => void;
  /** Hint shown under the field while there is no error. */
  helperText?: string;
  /** Error message. When set, the field is marked invalid and the message replaces the hint. */
  error?: string;
  disabled?: boolean;
  /** An icon drawn inside the field, before the text. */
  prefixIcon?: IconName;
}

/** A labelled single-line text field. */
export function Input({
  label,
  placeholder,
  value = '',
  onValueChange,
  helperText,
  error,
  disabled = false,
  prefixIcon,
  id,
  className,
  ...rest
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}input`;
  const messageId = `${inputId}-message`;
  const invalid = error !== undefined && error.length > 0;
  const message = invalid ? error : helperText !== undefined && helperText.length > 0 ? helperText : undefined;

  // Keep the field editable while following prop changes (React "derived state" pattern).
  const [current, setCurrent] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setCurrent(value);
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setCurrent(event.target.value);
    onValueChange?.(event.target.value);
  };

  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <div className={cx(styles.control, invalid && styles.invalid, disabled && styles.disabled)}>
        {prefixIcon !== undefined ? <Icon name={prefixIcon} size={16} className={styles.prefix} /> : null}
        <input
          {...rest}
          id={inputId}
          className={styles.input}
          placeholder={placeholder}
          value={current}
          onChange={handleChange}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={message !== undefined ? messageId : undefined}
        />
      </div>
      {message !== undefined ? (
        <p id={messageId} className={cx(styles.message, invalid && styles.errorMessage)}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
