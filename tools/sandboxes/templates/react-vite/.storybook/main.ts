import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  core: {
    // Sandboxes talk only to 127.0.0.1 (BUILD §3.1 rule 8).
    disableTelemetry: true,
    disableWhatsNewNotifications: true,
  },
};

export default config;
