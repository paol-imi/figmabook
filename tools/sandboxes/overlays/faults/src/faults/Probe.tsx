import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import './probe.css';

export const probeTones = ['neutral', 'info', 'success', 'warning', 'danger'] as const;
export type ProbeTone = (typeof probeTones)[number];

export interface ProbeProps {
  label: string;
  tone?: ProbeTone;
  /** Throws during React render. */
  crash?: boolean;
  /** Read by the `SlowLoader` story's loader, not by the component. */
  delayMs?: number;
}

/** A small box whose label and tone come from args; `crash` makes it throw while rendering. */
export function Probe({ label, tone = 'neutral', crash = false }: ProbeProps) {
  if (crash) throw new Error(`Probe "${label}" crashed on purpose`);
  return (
    <div className={`probe probe--${tone}`} data-tone={tone}>
      {label}
    </div>
  );
}

/** Changes its width on every animation frame: it never settles. */
export function Ticker({ label }: { label: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      setStep((value) => (value + 1) % 120);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="probe" style={{ width: 120 + step }}>
      {label}
    </div>
  );
}

export interface FrameProps {
  title: string;
  /** A React node arg: the channel can carry it, the URL cannot. */
  content?: ReactNode;
}

export function Frame({ title, content }: FrameProps) {
  return (
    <section className="probe-frame">
      <h3 className="probe-frame__title">{title}</h3>
      <div data-slot="content">{content}</div>
    </section>
  );
}
