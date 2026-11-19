/** Done or Failed: Copy results (in parts when large), Save results file, and the raw JSON. */
import { useState } from 'preact/hooks';
import { copyText, downloadFile } from '../../../_shared/dom.ts';
import { resultFileName } from '../../../_shared/envelope.ts';
import type { StepRun } from '../session.ts';

interface ResultPanelProps {
  readonly run: StepRun;
  readonly after: readonly string[];
  /** The result text, already split into paste-sized parts. */
  readonly parts: readonly string[];
  onBack(): void;
}

export function ResultPanel({ run, after, parts, onBack }: ResultPanelProps) {
  const { envelope, notes } = run;
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [shown, setShown] = useState(0);
  const done = envelope.status === 'done';
  const total = parts.length;

  const copy = (index: number) => {
    const ok = copyText(document, parts[index] ?? '');
    setShown(index);
    setFeedback(
      ok
        ? {
            ok,
            text:
              total > 1
                ? `Part ${index + 1} of ${total} copied. Paste it in the chat.`
                : 'Copied. Paste it in the chat.',
          }
        : { ok, text: 'Copy did not work. Click in the box below, press Cmd+A (Ctrl+A), then Cmd+C (Ctrl+C).' },
    );
  };

  const save = () => {
    for (const [index, part] of parts.entries()) {
      downloadFile(document, resultFileName(envelope.spike, envelope.step, { index: index + 1, total }), part);
    }
    setFeedback({ ok: true, text: 'Saved to your Downloads folder.' });
  };

  return (
    <section aria-label="Result">
      <h2 class={done ? 'ok-text' : 'error'}>{done ? 'Done' : 'Failed'}</h2>
      {!done && (
        <p role="alert" class="error">
          {String(envelope.results.error ?? 'Unknown error')}
        </p>
      )}
      {!done && <p>Please copy this report and paste it in the chat anyway. It helps.</p>}
      {notes.map((note) => (
        <p key={note} class="note-line">
          {note}
        </p>
      ))}
      <div class="actions">
        {parts.map((_, index) => (
          <button key={index} type="button" class="primary" onClick={() => copy(index)}>
            {total > 1 ? `Copy part ${index + 1} of ${total}` : done ? 'Copy results' : 'Copy error report'}
          </button>
        ))}
        <button type="button" onClick={save}>
          Save results file
        </button>
      </div>
      {feedback && (
        <p role="status" class={feedback.ok ? 'ok-text' : 'error'}>
          {feedback.text}
        </p>
      )}
      {done && after.map((line) => <p key={line}>{line}</p>)}
      <textarea class="json" readOnly aria-label="Result text" value={parts[shown] ?? ''} rows={8} />
      <button type="button" class="link" onClick={onBack}>
        ← Back to the steps
      </button>
    </section>
  );
}
