import type { ReactNode } from 'react';
import { cx } from '../../utils/cx.ts';
import styles from './Card.module.css';

export interface CardProps {
  title: string;
  /** Body copy. Clamped to three lines. */
  body: string;
  /** URL of a cover image, cropped to fill the media area. */
  media?: string;
  /** Actions shown in the footer, which sticks to the bottom of the card. */
  children?: ReactNode;
  className?: string | undefined;
}

/** A surface that groups a title, body copy, an optional cover image and actions. */
export function Card({ title, body, media, children, className }: CardProps) {
  return (
    <article className={cx(styles.card, className)}>
      {media !== undefined ? <img className={styles.media} src={media} alt="" data-part="media" /> : null}
      <div className={styles.content}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.body}>{body}</p>
        {children !== undefined && children !== null ? (
          <div className={styles.actions} data-slot="actions">
            {children}
          </div>
        ) : null}
      </div>
    </article>
  );
}
