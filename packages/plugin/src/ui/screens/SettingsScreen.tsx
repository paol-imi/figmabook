// biome-ignore lint/correctness/noUnusedImports: create-figma-plugin compiles JSX to the classic `h()` factory.
import { h } from 'preact';
import { EmptyState } from '../components/StateView';
import { t } from '../i18n';
import styles from './SettingsScreen.module.css';

export interface SettingsScreenProps {
  readonly pluginVersion: string;
  /** Bundle (Scene IR) majors this plugin can apply. */
  readonly irMajors: readonly number[];
}

/** Settings (11 §6.10): coming soon, plus the version facts a bug report needs. */
export function SettingsScreen({ pluginVersion, irMajors }: SettingsScreenProps) {
  return (
    <div>
      <EmptyState title={t('state.comingSoon')} body={<p>{t('settings.body')}</p>} />
      <section class={styles.about} aria-labelledby="holotype-settings-about">
        <h2 id="holotype-settings-about" class={styles.heading}>
          {t('settings.about')}
        </h2>
        <dl class={styles.facts}>
          <dt>{t('settings.version')}</dt>
          <dd>{pluginVersion}</dd>
          <dt>{t('settings.formats')}</dt>
          <dd>{t('settings.formatsValue', { majors: irMajors.map((major) => `v${major}`).join(', ') })}</dd>
        </dl>
      </section>
    </div>
  );
}
