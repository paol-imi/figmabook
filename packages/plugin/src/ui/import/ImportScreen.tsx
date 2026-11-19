// biome-ignore lint/correctness/noUnusedImports: create-figma-plugin compiles JSX to the classic `h()` factory.
import { h } from 'preact';
import { EmptyState } from '../components/StateView';
import { t } from '../i18n';

/**
 * Import file (11 §2.3, §6.11). The scaffold renders the empty state only; B-14 adds the
 * drop zone, unzip, validation, and the loading, error and success states.
 */
export function ImportScreen() {
  return <EmptyState title={t('import.empty.title')} body={<p>{t('import.empty.body')}</p>} />;
}
