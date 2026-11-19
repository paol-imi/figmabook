import type { Decorator, Preview } from '@storybook/react-vite';
import '../src/styles/fonts.css';
import '../src/tokens/tokens.css';
import '../src/styles/base.css';

export type Theme = 'light' | 'dark';

const themes: readonly Theme[] = ['light', 'dark'];

function isTheme(value: unknown): value is Theme {
  return themes.includes(value as Theme);
}

/**
 * Applies the `theme` global as `data-theme` on `<html>` (03 §8). It goes on the root element,
 * not a wrapper, so the story's DOM is unchanged and component tokens defined on `:root`
 * resolve against the themed aliases.
 */
const withTheme: Decorator = (Story, context) => {
  const theme: Theme = isTheme(context.globals.theme) ? context.globals.theme : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  return <Story />;
};

const preview: Preview = {
  // Every story is opted in to Figma; a story opts out with the `!figma` tag (README §7).
  tags: ['figma'],
  globalTypes: {
    theme: {
      description: 'Color theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  decorators: [withTheme],
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
  },
};

export default preview;
