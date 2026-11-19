/**
 * Authoring type for `parameters.holotype` in the fixture stories: the `HolotypeParams`
 * schema type of `@holotype/ir` (04 §9, plus `implements` from D-37 and `replacedBy`).
 * Stories use it with `satisfies`, so a typo in a key fails `tsc`, the way the addon's
 * types will once they ship.
 */
export type { HolotypeParams } from '@holotype/ir';
