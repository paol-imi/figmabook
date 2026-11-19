import { fileURLToPath } from 'node:url';

/** Storybook preset (02 §6.1): adds the addon's preview annotations. */
export function previewAnnotations(entries: readonly string[] = []): string[] {
  return [...entries, fileURLToPath(new URL('./preview.js', import.meta.url))];
}
