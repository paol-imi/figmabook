/**
 * The fake's `figma.mixed`: a unique, constant symbol returned where a property has more
 * than one value (typings:900-909, https://developers.figma.com/docs/plugins/api/properties/figma-mixed).
 *
 * `PluginAPI['mixed']` is declared as `unique symbol` inside Figma's typings, and TypeScript
 * can only create a value of a `unique symbol` type at that declaration, so no runtime value
 * can be typed as it without an assertion. It is one of the package's three type assertions
 * (README, "Type assertions"); every node and API member is checked structurally against the
 * typings.
 */
export const MIXED: PluginAPI['mixed'] = Symbol('figma.mixed') as PluginAPI['mixed'];

export type Mixed = PluginAPI['mixed'];
