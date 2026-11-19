// biome-ignore lint/correctness/noUnusedImports: create-figma-plugin compiles JSX to the classic `h()` factory.
import { h } from 'preact';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, LoadingState, SuccessState } from '../components/StateView';
import { t } from '../i18n';
import type { RunState } from '../run-state';

export interface ReportScreenProps {
  readonly run: RunState;
  readonly onCancel: () => void;
}

/**
 * Progress and report (11 §6.8–6.9) in their four states. The diagnostics list grouped by
 * code is a later item; the scaffold shows the count.
 */
export function ReportScreen({ run, onCancel }: ReportScreenProps) {
  switch (run.status) {
    case 'idle':
      return <EmptyState title={t('report.empty.title')} body={<p>{t('report.empty.body')}</p>} />;
    case 'running':
      return (
        <LoadingState
          title={t('report.running.title')}
          body={
            run.progress === null ? undefined : (
              <p>
                {t('report.running.step', {
                  stage: t(`stage.${run.progress.stage}`),
                  done: run.progress.done,
                  total: run.progress.total,
                })}
              </p>
            )
          }
          {...(run.progress === null ? {} : { progress: run.progress })}
          actions={<Button onClick={onCancel}>{t('report.cancel')}</Button>}
        />
      );
    case 'failed':
      return <ErrorState title={t('report.failed.title')} body={<p>{run.error.message}</p>} code={run.error.code} />;
    case 'done': {
      const { summary } = run;
      const messages = <p>{t('report.messages', { count: run.diagnostics.length })}</p>;
      if (summary.cancelled) {
        return (
          <EmptyState
            title={t('report.cancelled.title')}
            body={
              <div>
                <p>{t('report.cancelled.body')}</p>
                {messages}
              </div>
            }
          />
        );
      }
      return (
        <SuccessState
          title={t('report.done.title', { count: summary.componentsOk })}
          body={
            <div>
              <p>
                {t('report.done.variants', {
                  count: summary.variants,
                  seconds: (summary.durationMs / 1000).toFixed(1),
                })}
              </p>
              {summary.componentsFailed > 0 ? (
                <p>{t('report.done.failed', { count: summary.componentsFailed })}</p>
              ) : null}
              {messages}
            </div>
          }
        />
      );
    }
  }
}
