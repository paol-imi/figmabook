// biome-ignore lint/correctness/noUnusedImports: create-figma-plugin compiles JSX to the classic `h()` factory.
import { type ComponentChildren, h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { UiChannel } from '../channel';
import styles from './App.module.css';
import { Button } from './components/Button';
import { ErrorState, LoadingState } from './components/StateView';
import { type TabItem, Tabs } from './components/Tabs';
import { HANDSHAKE_TIMEOUT_MS, useHandshake, usePong, useRun } from './hooks';
import { t } from './i18n';
import { ImportScreen } from './import/ImportScreen';
import { useImport } from './import/use-import';
import { LibraryScreen } from './screens/LibraryScreen';
import { ReportScreen } from './screens/ReportScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export type TabId = 'library' | 'import' | 'report' | 'settings';

/** The plugin's top-level sections, in order (11 §5). */
export const TABS: readonly TabItem<TabId>[] = [
  { id: 'library', label: t('tabs.library') },
  { id: 'import', label: t('tabs.import') },
  { id: 'report', label: t('tabs.report') },
  { id: 'settings', label: t('tabs.settings') },
];

export interface AppProps {
  readonly channel: UiChannel;
  readonly uiVersion: string;
  readonly initialTab?: TabId;
  readonly handshakeTimeoutMs?: number;
}

export function App({
  channel,
  uiVersion,
  initialTab = 'import',
  handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS,
}: AppProps) {
  const [handshake, retry] = useHandshake(channel, uiVersion, handshakeTimeoutMs);
  const run = useRun(channel);
  const importer = useImport(channel);
  const [tab, setTab] = useState<TabId>(initialTab);
  usePong(channel);

  // A run that starts (from the CLI or an import) brings its progress into view.
  useEffect(() => {
    if (run.status === 'running') setTab('report');
  }, [run.status]);

  if (handshake.status === 'starting') {
    return (
      <main class={styles.app}>
        <LoadingState title={t('app.starting')} />
      </main>
    );
  }
  if (handshake.status === 'failed') {
    return (
      <main class={styles.app}>
        <ErrorState
          title={t('app.startFailed.title')}
          body={<p>{t('app.startFailed.body')}</p>}
          actions={
            <Button variant="primary" onClick={retry}>
              {t('app.retry')}
            </Button>
          }
        />
      </main>
    );
  }

  const screens: Readonly<Record<TabId, () => ComponentChildren>> = {
    library: () => <LibraryScreen onImportFile={() => setTab('import')} />,
    import: () => <ImportScreen state={importer.state} onFile={importer.importFile} onReset={importer.reset} />,
    report: () => <ReportScreen run={run} onCancel={() => channel.send({ t: 'cancel' })} />,
    settings: () => <SettingsScreen pluginVersion={handshake.info.pluginVersion} irMajors={handshake.info.irMajors} />,
  };

  return (
    <main class={styles.app}>
      <Tabs label={t('tabs.label')} items={TABS} selected={tab} onSelect={setTab}>
        {screens[tab]()}
      </Tabs>
    </main>
  );
}
