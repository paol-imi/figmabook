/**
 * The Holotype Spikes window: spike list → spike (steps) → running step (progress and manual
 * questions) → result (Copy results, Save results file). Plain Preact; styles in `styles.ts`.
 */
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { detectClient, splitIntoParts } from '../../../_shared/envelope.ts';
import { errorMessage } from '../../../_shared/json.ts';
import type { Ask, AskAnswer, SpikeDefinition, SpikeEnv, StepDefinition } from '../../../_shared/spike.ts';
import type { Bridge } from '../bridge.ts';
import { createStepIO, kitState, runStep, type StepRecord, type StepRun, stepRecordKey } from '../session.ts';
import { AskPanel } from './AskPanel.tsx';
import { ResultPanel } from './ResultPanel.tsx';

export interface AppProps {
  readonly spikes: readonly SpikeDefinition[];
  readonly bridge: Bridge;
  readonly kitVersion: string;
  readonly userAgent: string;
}

type Screen =
  | { readonly name: 'list' }
  | { readonly name: 'spike'; readonly spike: SpikeDefinition }
  | {
      readonly name: 'running';
      readonly spike: SpikeDefinition;
      readonly step: StepDefinition;
      readonly progress: string;
      readonly ask: { readonly question: Ask; readonly answer: (answer: AskAnswer) => void } | null;
    }
  | { readonly name: 'result'; readonly spike: SpikeDefinition; readonly step: StepDefinition; readonly run: StepRun };

type EnvState = { readonly env: SpikeEnv } | { readonly error: string } | null;

export function App({ spikes, bridge, kitVersion, userAgent }: AppProps) {
  const [envState, setEnvState] = useState<EnvState>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'list' });

  useEffect(() => {
    let live = true;
    bridge
      .call('kit/env', null)
      .then((value) => {
        const facts = value as { apiVersion: string; editorType: string };
        if (live)
          setEnvState({
            env: { apiVersion: facts.apiVersion, editorType: facts.editorType, ...detectClient(userAgent) },
          });
      })
      .catch((error: unknown) => live && setEnvState({ error: errorMessage(error) }));
    return () => {
      live = false;
    };
  }, [bridge, userAgent]);

  const start = useCallback(
    async (spike: SpikeDefinition, step: StepDefinition, env: SpikeEnv) => {
      setScreen({ name: 'running', spike, step, progress: 'Starting…', ask: null });
      const update = (patch: Partial<Extract<Screen, { name: 'running' }>>) =>
        setScreen((current) =>
          current.name === 'running' && current.step === step ? { ...current, ...patch } : current,
        );
      const io = createStepIO(bridge, spike.id, env, {
        onProgress: (progress) => update({ progress }),
        onAsk: (question) =>
          new Promise<AskAnswer>((resolve) =>
            update({
              ask: {
                question,
                answer: (answer) => {
                  update({ ask: null, progress: 'Continuing…' });
                  resolve(answer);
                },
              },
            }),
          ),
      });
      const run = await runStep(spike, step, io, kitVersion);
      setScreen({ name: 'result', spike, step, run });
    },
    [bridge, kitVersion],
  );

  if (envState === null) return <Shell kitVersion={kitVersion}>{<p class="muted">Starting…</p>}</Shell>;
  if ('error' in envState) {
    return (
      <Shell kitVersion={kitVersion}>
        <p role="alert" class="error">
          Could not start: {envState.error}
        </p>
      </Shell>
    );
  }
  const { env } = envState;

  switch (screen.name) {
    case 'list':
      return (
        <Shell kitVersion={kitVersion}>
          <p class="muted">Pick a spike. Each step tells you which file to run it in.</p>
          <ul class="list">
            {spikes.map((spike) => (
              <li key={spike.id}>
                <button type="button" class="row" onClick={() => setScreen({ name: 'spike', spike })}>
                  <strong>
                    {spike.id} · {spike.title}
                  </strong>
                  <span class="muted">
                    {spike.steps.length === 1 ? '1 step' : `${spike.steps.length} steps`} · about {spike.userTime}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Shell>
      );
    case 'spike':
      return (
        <SpikeScreen
          spike={screen.spike}
          bridge={bridge}
          kitVersion={kitVersion}
          onBack={() => setScreen({ name: 'list' })}
          onRun={(step) => void start(screen.spike, step, env)}
          onShow={(step, record) =>
            setScreen({ name: 'result', spike: screen.spike, step, run: { envelope: record.envelope, notes: [] } })
          }
        />
      );
    case 'running':
      return (
        <Shell kitVersion={kitVersion} title={`${screen.spike.id} · ${screen.step.label}`}>
          {screen.ask ? (
            <AskPanel question={screen.ask.question} onAnswer={screen.ask.answer} />
          ) : (
            <p class="progress" aria-live="polite">
              <span class="spinner" aria-hidden="true" /> {screen.progress}
            </p>
          )}
          <p class="muted">Keep this window open until you see Done.</p>
        </Shell>
      );
    case 'result':
      return (
        <Shell kitVersion={kitVersion} title={`${screen.spike.id} · ${screen.step.label}`}>
          <ResultPanel
            run={screen.run}
            after={screen.step.after ?? []}
            parts={splitIntoParts(JSON.stringify(screen.run.envelope, null, 1), screen.run.envelope)}
            onBack={() => setScreen({ name: 'spike', spike: screen.spike })}
          />
        </Shell>
      );
  }
}

function Shell({ kitVersion, title, children }: { kitVersion: string; title?: string; children: ComponentChildren }) {
  return (
    <main class="shell">
      <header class="header">
        <h1>{title ?? 'Holotype Spikes'}</h1>
        <span class="muted">kit {kitVersion}</span>
      </header>
      {children}
    </main>
  );
}

interface SpikeScreenProps {
  readonly spike: SpikeDefinition;
  readonly bridge: Bridge;
  readonly kitVersion: string;
  onBack(): void;
  onRun(step: StepDefinition): void;
  onShow(step: StepDefinition, record: StepRecord): void;
}

function SpikeScreen({ spike, bridge, kitVersion, onBack, onRun, onShow }: SpikeScreenProps) {
  const state = useMemo(() => kitState(bridge, spike.id), [bridge, spike.id]);
  const [records, setRecords] = useState<Readonly<Record<string, StepRecord>>>({});
  const [cleared, setCleared] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all(
      spike.steps.map(async (step) => [step.id, await state.get<StepRecord>(stepRecordKey(step.id))] as const),
    )
      .then((entries) => {
        if (!live) return;
        const found: Record<string, StepRecord> = {};
        for (const [id, record] of entries) if (record) found[id] = record;
        setRecords(found);
      })
      .catch(() => live && setRecords({}));
    return () => {
      live = false;
    };
  }, [spike, state, cleared]);

  const startOver = async () => {
    await bridge.call('kit/state.clear', { spike: spike.id });
    setCleared((count) => count + 1);
  };

  return (
    <Shell kitVersion={kitVersion} title={`${spike.id} · ${spike.title}`}>
      <button type="button" class="link" onClick={onBack}>
        ← All spikes
      </button>
      <p>{spike.question}</p>
      <ol class="steps">
        {spike.steps.map((step) => {
          const record = records[step.id];
          return (
            <li key={step.id} class="step">
              <div class="step-head">
                <strong>{step.label}</strong>
                {record && (
                  <span class={record.status === 'done' ? 'badge ok' : 'badge bad'}>
                    {record.status === 'done' ? 'Done' : 'Failed'}
                  </span>
                )}
              </div>
              <p class="muted">Run in: {step.where}</p>
              {(step.before ?? []).map((line) => (
                <p key={line}>{line}</p>
              ))}
              <div class="actions">
                <button type="button" class="primary" onClick={() => onRun(step)}>
                  Run {step.label}
                </button>
                {record && (
                  <button type="button" onClick={() => onShow(step, record)}>
                    Show last result
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {spike.steps.length > 1 && (
        <button type="button" class="link" onClick={() => void startOver()}>
          Start over (forget this spike's saved steps)
        </button>
      )}
    </Shell>
  );
}
