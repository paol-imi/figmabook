/**
 * S-16 fixture: a Button-like component set with VARIANT, BOOLEAN, TEXT and INSTANCE_SWAP
 * properties, a nested Badge with its own VARIANT, and 20 instance cases (BUILD B-32).
 */
import type { PropDef } from './model.ts';

export const BUTTON_DEFS: readonly PropDef[] = [
  {
    key: 'arg:variant',
    type: 'VARIANT',
    figmaName: 'Variant',
    argName: 'variant',
    // "Danger" is deliberately missing: it measures how a valueMap gap shows up.
    valueMap: [
      { figma: 'Primary', arg: 'primary' },
      { figma: 'Secondary', arg: 'secondary' },
    ],
  },
  {
    key: 'arg:size',
    type: 'VARIANT',
    figmaName: 'Size',
    argName: 'size',
    valueMap: [
      { figma: 'sm', arg: 'small' },
      { figma: 'md', arg: 'medium' },
    ],
  },
  {
    key: 'arg:iconPosition',
    type: 'BOOLEAN',
    figmaName: 'Show icon',
    argName: 'iconPosition',
    valueMap: [
      { figma: 'true', arg: 'start' },
      { figma: 'false', arg: 'none' },
    ],
  },
  { key: 'arg:children', type: 'TEXT', figmaName: 'Label', argName: 'children' },
  {
    key: 'arg:icon',
    type: 'INSTANCE_SWAP',
    figmaName: 'Icon',
    argName: 'icon',
    // "icon-bolt" exists but is not a preferred value.
    preferredValues: [
      { sid: 'icon-star', arg: 'star' },
      { sid: 'icon-heart', arg: 'heart' },
    ],
  },
];

export const BADGE_DEFS: readonly PropDef[] = [
  {
    key: 'arg:tone',
    type: 'VARIANT',
    figmaName: 'Tone',
    argName: 'tone',
    valueMap: [
      { figma: 'Neutral', arg: 'neutral' },
      { figma: 'Info', arg: 'info' },
    ],
  },
];

export const VARIANT_VALUES = ['Primary', 'Secondary', 'Danger'] as const;
export const SIZE_VALUES = ['md', 'sm'] as const;
export const ICON_SIDS = ['icon-star', 'icon-heart', 'icon-bolt'] as const;

export type CaseEdit =
  | { readonly kind: 'variant'; readonly values: Readonly<Record<string, string>> }
  | { readonly kind: 'props'; readonly values: Readonly<Record<string, string | boolean>> }
  | { readonly kind: 'swap'; readonly sid: string }
  | { readonly kind: 'swap-sublayer'; readonly sid: string }
  | { readonly kind: 'sublayer-characters'; readonly role: string; readonly text: string }
  | { readonly kind: 'sublayer-visible'; readonly role: string; readonly visible: boolean }
  | { readonly kind: 'fill' }
  | { readonly kind: 'effect' }
  | { readonly kind: 'resize'; readonly width: number }
  | { readonly kind: 'nested-variant'; readonly role: string; readonly values: Readonly<Record<string, string>> };

export type PropertyKind = 'VARIANT' | 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'nested';

export type RoundTripCase = {
  readonly id: string;
  readonly label: string;
  /** Property kinds this case exercises (for the reversibility table). */
  readonly kinds: readonly PropertyKind[];
  readonly edits: readonly CaseEdit[];
  /** What we expect, so the result can flag surprises. */
  readonly expect: { readonly unmapped: boolean; readonly deviation: boolean };
};

const none = { unmapped: false, deviation: false } as const;

export const CASES: readonly RoundTripCase[] = [
  { id: 'C01', label: 'defaults', kinds: ['VARIANT', 'BOOLEAN', 'TEXT', 'INSTANCE_SWAP'], edits: [], expect: none },
  {
    id: 'C02',
    label: 'Variant=Secondary',
    kinds: ['VARIANT'],
    edits: [{ kind: 'variant', values: { Variant: 'Secondary' } }],
    expect: none,
  },
  {
    id: 'C03',
    label: 'Variant=Danger (no valueMap entry)',
    kinds: ['VARIANT'],
    edits: [{ kind: 'variant', values: { Variant: 'Danger' } }],
    expect: { unmapped: true, deviation: false },
  },
  {
    id: 'C04',
    label: 'Size=sm',
    kinds: ['VARIANT'],
    edits: [{ kind: 'variant', values: { Size: 'sm' } }],
    expect: none,
  },
  {
    id: 'C05',
    label: 'Show icon=false',
    kinds: ['BOOLEAN'],
    edits: [{ kind: 'props', values: { 'Show icon': false } }],
    expect: none,
  },
  {
    id: 'C06',
    label: 'Label="Buy now"',
    kinds: ['TEXT'],
    edits: [{ kind: 'props', values: { Label: 'Buy now' } }],
    expect: none,
  },
  {
    id: 'C07',
    label: 'Label="" (empty)',
    kinds: ['TEXT'],
    edits: [{ kind: 'props', values: { Label: '' } }],
    expect: none,
  },
  {
    id: 'C08',
    label: 'Label with non-ASCII text',
    kinds: ['TEXT'],
    edits: [{ kind: 'props', values: { Label: 'Größe ✓ 日本' } }],
    expect: none,
  },
  {
    id: 'C09',
    label: 'Icon=heart (property)',
    kinds: ['INSTANCE_SWAP'],
    edits: [{ kind: 'swap', sid: 'icon-heart' }],
    expect: none,
  },
  {
    id: 'C10',
    label: 'Icon=bolt (not a preferred value)',
    kinds: ['INSTANCE_SWAP'],
    edits: [{ kind: 'swap', sid: 'icon-bolt' }],
    expect: { unmapped: true, deviation: false },
  },
  {
    id: 'C11',
    label: 'all properties changed together',
    kinds: ['VARIANT', 'BOOLEAN', 'TEXT', 'INSTANCE_SWAP'],
    edits: [
      { kind: 'variant', values: { Variant: 'Secondary', Size: 'sm' } },
      { kind: 'props', values: { 'Show icon': false, Label: 'Combo' } },
      { kind: 'swap', sid: 'icon-heart' },
    ],
    expect: none,
  },
  {
    id: 'C12',
    label: 'fill override on the instance',
    kinds: [],
    edits: [{ kind: 'fill' }],
    expect: { unmapped: false, deviation: true },
  },
  {
    id: 'C13',
    label: 'label layer text edited directly (bound to Label)',
    kinds: ['TEXT'],
    edits: [{ kind: 'sublayer-characters', role: 'label', text: 'Typed in layer' }],
    expect: none,
  },
  {
    id: 'C14',
    label: 'unbound text layer edited (hint)',
    kinds: [],
    edits: [{ kind: 'sublayer-characters', role: 'hint', text: 'Changed hint' }],
    expect: { unmapped: false, deviation: true },
  },
  {
    id: 'C15',
    label: 'badge layer hidden (no property)',
    kinds: [],
    edits: [{ kind: 'sublayer-visible', role: 'badge', visible: false }],
    expect: { unmapped: false, deviation: true },
  },
  {
    id: 'C16',
    label: 'nested Badge Tone=Info',
    kinds: ['nested'],
    edits: [{ kind: 'nested-variant', role: 'badge', values: { Tone: 'Info' } }],
    expect: none,
  },
  {
    id: 'C17',
    label: 'instance resized wider',
    kinds: [],
    edits: [{ kind: 'resize', width: 260 }],
    expect: { unmapped: false, deviation: true },
  },
  {
    id: 'C18',
    label: 'icon layer swapped directly (swapComponent)',
    kinds: ['INSTANCE_SWAP'],
    edits: [{ kind: 'swap-sublayer', sid: 'icon-heart' }],
    expect: none,
  },
  {
    id: 'C19',
    label: 'Danger + sm + label text',
    kinds: ['VARIANT', 'TEXT'],
    edits: [
      { kind: 'variant', values: { Variant: 'Danger', Size: 'sm' } },
      { kind: 'props', values: { Label: 'Delete' } },
    ],
    expect: { unmapped: true, deviation: false },
  },
  {
    id: 'C20',
    label: 'effect override on the instance',
    kinds: [],
    edits: [{ kind: 'effect' }],
    expect: { unmapped: false, deviation: true },
  },
];
