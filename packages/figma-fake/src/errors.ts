import { NotImplementedError } from '@holotype/shared';

/**
 * Typings file every citation in this package points into: `@figma/plugin-typings@1.142.0`,
 * `plugin-api.d.ts`. A comment `typings:1086` means line 1086 of that file.
 */
export const TYPINGS = '@figma/plugin-typings@1.142.0/plugin-api.d.ts';

/**
 * The error the Plugin API throws for an invalid call.
 *
 * Figma throws plain `Error` objects whose message starts with the internal name of the
 * failing call, e.g. `in set_characters: Cannot write to node with unloaded font "Inter
 * Regular". …`. The fake throws the same class with the same prefix. Message texts are
 * modelled on the real ones but are not guaranteed to match byte for byte (README,
 * "Differences"), so tests should match on the class and a keyword.
 */
export function figmaError(api: string, message: string): Error {
  return new Error(`in ${api}: ${message}`);
}

/** Internal name Figma uses for a property setter, e.g. `set_characters`. */
export function setterName(property: string): string {
  return `set_${property}`;
}

/**
 * A member the slice does not model yet. It fails loudly instead of returning a plausible
 * value, so a test can never pass on behaviour the fake does not emulate.
 *
 * @param member `Type.member`, e.g. `InstanceNode.overrides`.
 * @param item the work item that adds it (BUILD §8).
 */
export function unsupported(member: string, item: 'B-111' | 'B-125' | 'B-139' | 'B-142' | 'hardening'): never {
  throw new NotImplementedError(`figma-fake: ${member}`, item);
}
