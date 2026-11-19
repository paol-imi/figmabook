import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import './custom.css';

/** The default theme, plus a pre-release notice above the home page hero text. */
export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-hero-info-before': () =>
        h('p', { class: 'ht-status', role: 'note' }, [
          h('span', { class: 'ht-status-label' }, 'Pre-release'),
          ' Holotype is being built. Nothing is ready to install yet.',
        ]),
    }),
} satisfies Theme;
