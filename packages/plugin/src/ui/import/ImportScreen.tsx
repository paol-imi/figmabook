// biome-ignore lint/correctness/noUnusedImports: create-figma-plugin compiles JSX to the classic `h()` factory.
import { type ComponentChildren, h } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, LoadingState, SuccessState } from '../components/StateView';
import { type MessageKey, t } from '../i18n';
import styles from './ImportScreen.module.css';
import type { ImportFile, ImportState } from './use-import';

export interface ImportScreenProps {
  readonly state: ImportState;
  readonly onFile: (file: ImportFile) => void;
  readonly onReset: () => void;
}

/** Designer-facing copy per diagnostic code (11 §6.11–6.12); the code itself is shown too. */
const ERROR_COPY: Readonly<Record<string, MessageKey>> = {
  APPLY_BUNDLE_CORRUPT: 'import.error.APPLY_BUNDLE_CORRUPT',
  APPLY_BUNDLE_REJECTED: 'import.error.APPLY_BUNDLE_REJECTED',
  APPLY_IR_VERSION_UNSUPPORTED: 'import.error.APPLY_IR_VERSION_UNSUPPORTED',
  APPLY_UNSUPPORTED_FEATURE: 'import.error.APPLY_UNSUPPORTED_FEATURE',
  APPLY_NO_EDIT_ACCESS: 'import.error.APPLY_NO_EDIT_ACCESS',
};

function errorText(code: string, message: string, value: string | undefined): string {
  const key = ERROR_COPY[code];
  return key === undefined ? message : t(key, { features: value ?? '' });
}

interface FilePickerProps {
  readonly label: string;
  readonly variant?: 'primary' | 'secondary';
  readonly onFile: (file: ImportFile) => void;
  readonly children?: ComponentChildren;
}

/**
 * A drop zone with a "Choose file" button (11 §2.3). Keyboard users reach the button; the
 * file input itself is visually hidden but labelled for assistive technology.
 */
function FilePicker({ label, variant = 'primary', onFile, children }: FilePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) onFile(file);
  };
  return (
    <section
      class={`${styles.zone} ${over ? styles.over : ''}`}
      aria-label={t('import.drop.label')}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take(event.dataTransfer?.files);
      }}
    >
      {children}
      <input
        ref={input}
        class={styles.input}
        type="file"
        accept=".zip,application/zip"
        aria-label={t('import.input')}
        tabIndex={-1}
        onChange={(event) => {
          take(event.currentTarget.files);
          event.currentTarget.value = ''; // picking the same file again still imports it
        }}
      />
      <Button variant={variant} onClick={() => input.current?.click()}>
        {label}
      </Button>
    </section>
  );
}

/** Import file (11 §2.3, §6.11) in its four states. */
export function ImportScreen({ state, onFile, onReset }: ImportScreenProps) {
  switch (state.status) {
    case 'empty':
      return (
        <EmptyState
          title={t('import.empty.title')}
          body={<p>{t('import.empty.body')}</p>}
          actions={
            <FilePicker label={t('import.choose')} onFile={onFile}>
              <p class={styles.hint}>{t('import.drop.label')}</p>
            </FilePicker>
          }
        />
      );
    case 'loading':
      return (
        <LoadingState
          title={t('import.loading.title', { file: state.fileName })}
          body={<p>{t('import.loading.body')}</p>}
        />
      );
    case 'error': {
      const { code, message, value } = state.diagnostic;
      return (
        <ErrorState
          title={t('import.error.title')}
          code={code}
          body={
            <div>
              <p>{errorText(code, message, value)}</p>
              {state.fileName === undefined ? null : <p>{t('import.error.file', { file: state.fileName })}</p>}
            </div>
          }
          actions={<FilePicker label={t('import.error.chooseAnother')} variant="secondary" onFile={onFile} />}
        />
      );
    }
    case 'success':
      return (
        <SuccessState
          title={t('import.success.title')}
          body={
            <p>
              {t('import.success.body', {
                components: state.components,
                variants: state.variants,
                file: state.fileName,
              })}
            </p>
          }
          actions={<Button onClick={onReset}>{t('import.another')}</Button>}
        />
      );
  }
}
