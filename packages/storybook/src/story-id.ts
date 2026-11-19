/**
 * The component id (`sid`) of a story: the story-id prefix before `--`, e.g.
 * `components-button--primary` → `components-button` (README §7).
 */
export function componentIdFromStoryId(storyId: string): string {
  const separator = storyId.indexOf('--');
  if (separator <= 0) throw new TypeError(`Not a Storybook story id: "${storyId}".`);
  return storyId.slice(0, separator);
}

/** Whether `value` has the `<component>--<story>` shape of a Storybook story id. */
export function isStoryId(value: string): boolean {
  return value.indexOf('--') > 0;
}
