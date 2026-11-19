import { APPLIED_GROUPS, Enum, Hash16Schema } from '@holotype/ir';
import { type Static, Type } from '@sinclair/typebox';

/*
 * Shared pieces of the DCR documents (15 §4, §6). Like the IR documents (06 §7) they are
 * *open*: a reader ignores fields it does not know within a known major, so objects do not
 * set `additionalProperties`. Every number in them is already normalized (floats to 1e-3,
 * color channels to 1e-4, 15 §4.1), which `canonicalDcr` keeps exact.
 */

/** A Figma node id: `12:40`, or an instance sublayer `I12:40;5:6` (10 §2.1). */
export const FigmaNodeIdSchema = Type.String({ pattern: '^I?\\d+:\\d+(?:;\\d+:\\d+)*$' });

/** A 16-hex DCR, item or snapshot hash (`h16`, 06 §6). */
export const DcrHashSchema = Hash16Schema;

/** A Storybook component id, e.g. `components-button`. */
export const SidSchema = Type.String({ minLength: 1 });

/** A variant key `vk` (06 §6). */
export const VkSchema = Hash16Schema;

/** A git commit sha, abbreviated or full. */
export const CommitSchema = Type.String({ pattern: '^[0-9a-f]{7,64}$' });

/** A catalog diagnostic code of the `DCR_` domain (15 §11). */
export const DcrCodeSchema = Type.String({ pattern: '^DCR_[A-Z0-9]+(?:_[A-Z0-9]+)*$' });

/** A CSS custom property name, e.g. `--space-4` (`codeSyntax.WEB`, 15 §4.7). */
export const CssVarSchema = Type.String({ pattern: '^--.+' });

/** The `ah` property groups (06 §6), in hash order. */
export const GroupSchema = Enum(...APPLIED_GROUPS);
export type Group = Static<typeof GroupSchema>;

/**
 * Designer-authored text: layer, frame and component names, text content, annotations,
 * notes, URLs. Untrusted (D-38, 15 §10.3): renderers fence or escape it, never put it in an
 * instruction. Stored as written; the caps of §10.3 apply when rendering.
 */
export const UntrustedTextSchema = Type.String({ description: 'Untrusted designer text (D-38)' });

/** Variant property values by axis name as Figma shows them, e.g. `{ "Tone": "Danger" }`. */
export const VariantValuesSchema = Type.Record(Type.String(), Type.String());
export type VariantValues = Static<typeof VariantValuesSchema>;
