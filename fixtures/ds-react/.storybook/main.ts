import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  core: {
    // Builds and tests must not reach outside 127.0.0.1 (BUILD §3.1 rule 8).
    disableTelemetry: true,
    disableWhatsNewNotifications: true,
  },
  // CSS source maps in the dev server: branch mode maps Figma edits back to CSS rules (S-19).
  viteFinal: (viteConfig) => mergeConfig(viteConfig, { css: { devSourcemap: true } }),
};

export default config;
