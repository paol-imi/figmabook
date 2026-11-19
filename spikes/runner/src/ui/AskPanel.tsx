/** A manual step: short instructions plus Continue, or a choice with an optional one-line note. */
import { useState } from 'preact/hooks';
import type { Ask, AskAnswer } from '../../../_shared/spike.ts';

export function AskPanel({ question, onAnswer }: { question: Ask; onAnswer(answer: AskAnswer): void }) {
  const [note, setNote] = useState('');
  return (
    <section class="ask" aria-label="Your turn">
      <h2>Your turn</h2>
      {question.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {question.kind === 'choice' && question.note && (
        <label class="note">
          {question.note.label}
          <input type="text" value={note} onInput={(event) => setNote(event.currentTarget.value)} />
        </label>
      )}
      <div class="actions">
        {question.kind === 'continue' ? (
          <button type="button" class="primary" onClick={() => onAnswer({ choice: 'continue', note: '' })}>
            {question.button ?? 'Continue'}
          </button>
        ) : (
          question.choices.map((choice) => (
            <button key={choice.id} type="button" class="primary" onClick={() => onAnswer({ choice: choice.id, note })}>
              {choice.label}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
