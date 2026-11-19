import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Read by Storybook's Vite builder; `.storybook/main.ts` adds the Storybook-only settings. */
export default defineConfig({
  plugins: [react()],
});
