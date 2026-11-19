import type { ReactNode } from 'react';
import { cx } from '../../utils/cx.ts';
import styles from './Stack.module.css';

export type StackDirection = 'row' | 'column';
/** A step of the `--space-*` scale. */
export type StackGap = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type StackAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type StackJustify = 'start' | 'center' | 'end' | 'between';

export interface StackProps {
  direction?: StackDirection;
  gap?: StackGap;
  /** Cross-axis alignment of the children. */
  align?: StackAlign;
  /** Main-axis distribution of the children. */
  justify?: StackJustify;
  /** Lets children flow onto more lines when they do not fit. */
  wrap?: boolean;
  children?: ReactNode;
  className?: string | undefined;
}

const gapClass: Record<StackGap, string | undefined> = {
  1: styles.gap1,
  2: styles.gap2,
  3: styles.gap3,
  4: styles.gap4,
  5: styles.gap5,
  6: styles.gap6,
  7: styles.gap7,
  8: styles.gap8,
};

const alignClass: Record<StackAlign, string | undefined> = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd,
  stretch: styles.alignStretch,
  baseline: styles.alignBaseline,
};

const justifyClass: Record<StackJustify, string | undefined> = {
  start: styles.justifyStart,
  center: styles.justifyCenter,
  end: styles.justifyEnd,
  between: styles.justifyBetween,
};

/** A flex container that spaces its children on one axis. */
export function Stack({
  direction = 'column',
  gap = 2,
  align = 'stretch',
  justify = 'start',
  wrap = false,
  children,
  className,
}: StackProps) {
  return (
    <div
      className={cx(
        styles.stack,
        styles[direction],
        gapClass[gap],
        alignClass[align],
        justifyClass[justify],
        wrap && styles.wrap,
        className,
      )}
    >
      {children}
    </div>
  );
}
