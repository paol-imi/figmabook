/*
 * The four screen states every user-facing flow implements (BUILD §3.2, 11 §6.11):
 * empty, loading, error and success. Each has a heading, a plain-language body and at most
 * a couple of actions. Status is never shown by color alone: every state has text, and the
 * loading, error and success states an icon too.
 */
// biome-ignore lint/correctness/noUnusedImports: create-figma-plugin compiles JSX to the classic `h()` factory.
import { type ComponentChildren, Fragment, h } from 'preact';
import { t } from '../i18n';
import styles from './StateView.module.css';

export interface StateProps {
  readonly title: string;
  readonly body?: ComponentChildren;
  readonly actions?: ComponentChildren;
}

interface FrameProps extends StateProps {
  readonly tone: 'neutral' | 'danger' | 'success';
  readonly icon?: ComponentChildren;
  /** Live-region role: `status` is announced politely, `alert` at once. */
  readonly role?: 'status' | 'alert';
  readonly busy?: boolean;
}

function Frame({ title, body, actions, icon, tone, role, busy }: FrameProps) {
  return (
    <section class={`${styles.state} ${styles[tone]}`} role={role} aria-busy={busy} aria-label={title}>
      {icon === undefined ? null : (
        <span class={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <h2 class={styles.title}>{title}</h2>
      {body === undefined ? null : <div class={styles.body}>{body}</div>}
      {actions === undefined ? null : <div class={styles.actions}>{actions}</div>}
    </section>
  );
}

/** Nothing here yet: says what this place is for and the one next step. */
export function EmptyState(props: StateProps) {
  return <Frame {...props} tone="neutral" />;
}

export interface LoadingStateProps extends StateProps {
  readonly progress?: { readonly done: number; readonly total: number };
}

/** Work in progress, announced politely to screen readers, with an optional progress bar. */
export function LoadingState({ progress, body, ...props }: LoadingStateProps) {
  return (
    <Frame
      {...props}
      tone="neutral"
      role="status"
      busy
      icon={<span class={styles.spinner} />}
      body={
        <Fragment>
          {body}
          {progress === undefined ? null : (
            <progress
              class={styles.progress}
              max={Math.max(progress.total, 1)}
              value={progress.done}
              aria-label={props.title}
            />
          )}
        </Fragment>
      }
    />
  );
}

export interface ErrorStateProps extends StateProps {
  /** Diagnostic code (12 §6), shown so the user can look it up or report it. */
  readonly code?: string;
}

/** Something failed: what happened, the diagnostic code, and how to recover (11 §6.12). */
export function ErrorState({ code, body, ...props }: ErrorStateProps) {
  return (
    <Frame
      {...props}
      tone="danger"
      role="alert"
      icon="!"
      body={
        <Fragment>
          {body}
          {code === undefined ? null : <p class={styles.code}>{t('state.code', { code })}</p>}
        </Fragment>
      }
    />
  );
}

/** A finished operation. */
export function SuccessState(props: StateProps) {
  return <Frame {...props} tone="success" role="status" icon="✓" />;
}
