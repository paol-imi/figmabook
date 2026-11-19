import { Enum } from '@holotype/ir';
import { type Static, Type } from '@sinclair/typebox';
import { DcrHashSchema, FigmaNodeIdSchema, UntrustedTextSchema } from './primitives';
import { UsageDeltaSchema, UsageNodeRef, UsageSnippetSchema } from './usage';

/*
 * Screens (15 §4.10–§4.12): one `screen` item per screen name, with one variant per
 * (breakpoint, state). The Loop slice emits one variant per screen, usage only, with empty
 * `interactions` and `a11y`.
 */

/** A destination of a prototype interaction (15 §4.11). */
export const ScreenRefSchema = Type.Object({
  /** Absent when the destination is not in scope (DCR_INTERACTION_TARGET_OUT_OF_SCOPE). */
  itemId: Type.Optional(DcrHashSchema),
  variant: Type.Optional(Type.Object({ breakpoint: Type.String(), state: Type.String() })),
  figmaNodeId: FigmaNodeIdSchema,
  name: UntrustedTextSchema,
});
export type ScreenRef = Static<typeof ScreenRefSchema>;

export const InteractionTriggerSchema = Enum('click', 'hover', 'press', 'key', 'timeout', 'enter', 'leave', 'drag');

export const InteractionActionSchema = Type.Union([
  Type.Object({
    kind: Enum('navigate', 'overlay', 'swap-overlay'),
    to: ScreenRefSchema,
    overlay: Type.Optional(Type.Object({ position: Type.String(), closeOnOutside: Type.Boolean() })),
  }),
  Type.Object({ kind: Type.Literal('scroll-to'), to: Type.String({ minLength: 1 }) }),
  /** `CHANGE_TO` a variant; `coveredByCode` when that state already exists in code. */
  Type.Object({
    kind: Type.Literal('state'),
    values: Type.Record(Type.String(), Type.String()),
    coveredByCode: Type.Boolean(),
  }),
  Type.Object({ kind: Type.Literal('back') }),
  Type.Object({ kind: Type.Literal('close-overlay') }),
  /** Kept as text, never fetched (15 §10.2). */
  Type.Object({ kind: Type.Literal('open-url'), url: UntrustedTextSchema }),
  /** e.g. `SET_VARIABLE`, `CONDITIONAL` (DCR_INTERACTION_UNSUPPORTED). */
  Type.Object({ kind: Type.Literal('unsupported'), figma: Type.String() }),
]);
export type InteractionAction = Static<typeof InteractionActionSchema>;

/** One (trigger, action) pair of a prototype reaction (15 §4.11). */
export const DcrInteractionSchema = Type.Object({
  /** Usage-node key of the trigger. */
  from: Type.String({ minLength: 1 }),
  trigger: InteractionTriggerSchema,
  keyCodes: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))),
  delayMs: Type.Optional(Type.Number({ minimum: 0 })),
  action: InteractionActionSchema,
});
export type DcrInteraction = Static<typeof DcrInteractionSchema>;

/** An accessibility annotation, parsed from `key: value` lines (15 §4.12). All text is untrusted. */
export const A11yAnnotationSchema = Type.Object({
  /** Usage-node key the annotation is attached to. */
  key: Type.String({ minLength: 1 }),
  role: Type.Optional(Type.String()),
  label: Type.Optional(UntrustedTextSchema),
  focusOrder: Type.Optional(Type.Integer({ minimum: 1 })),
  heading: Type.Optional(Type.Integer({ minimum: 1, maximum: 6 })),
  /** `""` means decorative. */
  alt: Type.Optional(UntrustedTextSchema),
  live: Type.Optional(Enum('polite', 'assertive', 'off')),
  notes: Type.Optional(Type.Array(UntrustedTextSchema)),
});
export type A11yAnnotation = Static<typeof A11yAnnotationSchema>;

/** One frame of a screen: a (breakpoint, state) pair (15 §4.10). */
export const ScreenVariantSchema = Type.Object({
  breakpoint: Type.Object({
    name: Type.String({ minLength: 1 }),
    minWidth: Type.Number({ minimum: 0 }),
    /** No breakpoint segment in the name: inferred from the frame width. */
    inferred: Type.Optional(Type.Literal(true)),
  }),
  /** Canonical state name, e.g. `default`, `empty`. */
  state: Type.String({ minLength: 1 }),
  figmaNodeId: FigmaNodeIdSchema,
  frameName: UntrustedTextSchema,
  width: Type.Number({ minimum: 0 }),
  height: Type.Number({ minimum: 0 }),
  /** The full usage tree. */
  structure: Type.Array(UsageNodeRef),
  /** Against the base variant; absent on the base. */
  delta: Type.Optional(Type.Array(UsageDeltaSchema)),
  interactions: Type.Array(DcrInteractionSchema),
  a11y: Type.Array(A11yAnnotationSchema),
  snippet: UsageSnippetSchema,
  /** Role id `<itemId>:<breakpoint>:<state>`. */
  asset: Type.String({ minLength: 1 }),
});
export type ScreenVariant = Static<typeof ScreenVariantSchema>;
