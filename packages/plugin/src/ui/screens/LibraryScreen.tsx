// biome-ignore lint/correctness/noUnusedImports: create-figma-plugin compiles JSX to the classic `h()` factory.
import { h } from 'preact';
import { Button } from '../components/Button';
import { EmptyState } from '../components/StateView';
import { t } from '../i18n';

/** Component browser (11 §6.3). Until the server connection lands, it points to file import. */
export function LibraryScreen({ onImportFile }: { readonly onImportFile: () => void }) {
  return (
    <EmptyState
      title={t('state.comingSoon')}
      body={<p>{t('library.body')}</p>}
      actions={
        <Button variant="primary" onClick={onImportFile}>
          {t('library.goToImport')}
        </Button>
      }
    />
  );
}
