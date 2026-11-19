import { type Static, Type } from '@sinclair/typebox';
import { DcrHashSchema } from './primitives';

/*
 * Reviewer and agent input (D-56, 15 §6 "answers"). Both live next to `dcr.json`, never in
 * it, so answering or deciding never changes `dcrHash`.
 */

/**
 * Reviewer answers to open questions: `branch:meta.answers` in the Figma file, written by
 * the CLI to `answers.json` unchanged. Bound to one `dcrHash`, like approval (D-44).
 */
export const DcrAnswersSchema = Type.Object(
  {
    dcrHash: DcrHashSchema,
    /** Question id → the chosen option (or the reviewer's own text, untrusted). */
    byQuestion: Type.Record(Type.String({ minLength: 1 }), Type.String()),
  },
  { title: 'Holotype DCR answers (DcrAnswers)' },
);
export type DcrAnswers = Static<typeof DcrAnswersSchema>;

/** One choice the agent made on its own (15 §8 rules 2, 4, 6). */
export const DcrDecisionSchema = Type.Object({
  itemId: DcrHashSchema,
  /** The open question this resolves, when it resolves one. */
  questionId: Type.Optional(Type.String({ minLength: 1 })),
  /** `chosen`: picked an option or value; `not-implemented`: the item could not be built. */
  outcome: Type.Union([Type.Literal('chosen'), Type.Literal('not-implemented')]),
  /** The option or value chosen, e.g. `--radius-md` or `extend Badge`. */
  choice: Type.Optional(Type.String()),
  reason: Type.String({ minLength: 1 }),
});
export type DcrDecision = Static<typeof DcrDecisionSchema>;

/** `decisions.json`: written by the coding agent (15 §8). */
export const DcrDecisionsSchema = Type.Object(
  {
    kind: Type.Literal('holotype/dcr-decisions'),
    v: Type.Literal(1),
    /** The request these decisions are for. */
    dcrId: DcrHashSchema,
    decisions: Type.Array(DcrDecisionSchema),
  },
  { title: 'Holotype DCR agent decisions (DcrDecisions)' },
);
export type DcrDecisions = Static<typeof DcrDecisionsSchema>;
