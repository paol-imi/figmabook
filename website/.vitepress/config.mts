import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type DefaultTheme, defineConfig } from 'vitepress';
import {
  DIAGNOSTICS_INDEX,
  DIAGNOSTICS_ROUTE,
  DIAGNOSTICS_SOURCE,
  type DiagnosticArea,
  diagnosticAreas,
  loadDiagnosticPages,
  type SearchSection,
  searchSections,
} from './lib/diagnostics.ts';
import { DESIGN_DOCS_REPO_URL, REPO_ROOT, REPO_URL, SITE_BASE } from './lib/env.ts';
import { repoLink } from './lib/site.ts';

const areas = diagnosticAreas(readFileSync(join(REPO_ROOT, DIAGNOSTICS_SOURCE, DIAGNOSTICS_INDEX), 'utf8'));

/** Search sections of the dynamic diagnostics pages, keyed by the route file VitePress indexes. */
const diagnosticsSearch = new Map(
  loadDiagnosticPages(join(REPO_ROOT, DIAGNOSTICS_SOURCE), DESIGN_DOCS_REPO_URL).map((page) => [
    resolve(REPO_ROOT, 'website', `.${DIAGNOSTICS_ROUTE}${page.slug}.md`),
    searchSections(page),
  ]),
);

type SplitIntoSections = NonNullable<NonNullable<DefaultTheme.LocalSearchOptions['miniSearch']>['_splitIntoSections']>;

/**
 * VitePress's local search reads pages from disk, so dynamic routes would be indexed empty.
 * For other pages this returns `undefined`, and VitePress falls back to its own splitter.
 */
const splitIntoSections = ((file: string): SearchSection[] | undefined =>
  diagnosticsSearch.get(resolve(file))) as SplitIntoSections;

function areaItem(area: DiagnosticArea): DefaultTheme.SidebarItem {
  return {
    text: `${area.title} (${area.prefix}_)`,
    collapsed: true,
    items: area.codes.map((code) => ({ text: code, link: `${DIAGNOSTICS_ROUTE}${code}` })),
  };
}

/** Only with `HOLOTYPE_SITE_PLAN_LINKS=repo`: the design docs are internal by default. */
const designDocs: DefaultTheme.NavItemWithLink[] = DESIGN_DOCS_REPO_URL
  ? [{ text: 'Design docs', link: repoLink(DESIGN_DOCS_REPO_URL, 'docs/plan', 'tree') }]
  : [];

export default defineConfig({
  title: 'Holotype',
  description:
    'Holotype mirrors Storybook components as native Figma components, and turns design edits into change requests that an AI agent implements and Holotype verifies.',
  lang: 'en-US',
  base: SITE_BASE,
  // The package README is for contributors, not a page.
  srcExclude: ['README.md'],
  // Dead links fail the build (VitePress default); keep it that way.
  ignoreDeadLinks: false,
  lastUpdated: false,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${SITE_BASE}logo.svg` }]],

  markdown: {
    config(md) {
      // Inline code is literal text: never let Vue read `{{…}}` in it as an interpolation.
      const render = md.renderer.rules.code_inline;
      md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
        tokens[idx]?.attrSet('v-pre', '');
        return render ? render(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
      };
    },
  },

  transformPageData(pageData) {
    const code = pageData.params?.code;
    if (typeof code === 'string' && code !== 'index') {
      return { title: code, description: `Holotype diagnostic ${code}: what happened and what to do.` };
    }
    return undefined;
  },

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/how-it-works', activeMatch: '^/guide/' },
      { text: 'Reference', link: '/reference/cli', activeMatch: '^/reference/' },
      { text: 'Roadmap', link: '/roadmap' },
      ...designDocs,
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'How it works', link: '/guide/how-it-works' },
            { text: 'Concepts', link: '/guide/concepts' },
            { text: 'Getting started', link: '/guide/getting-started' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'CLI commands', link: '/reference/cli' },
            { text: 'Exit codes', link: '/reference/exit-codes' },
            { text: 'Configuration', link: '/reference/configuration' },
            { text: 'Diagnostics', link: DIAGNOSTICS_ROUTE },
          ],
        },
        { text: 'Diagnostics by area', items: areas.map(areaItem) },
      ],
    },
    search: { provider: 'local', options: { miniSearch: { _splitIntoSections: splitIntoSections } } },
    outline: { level: [2, 3] },
    socialLinks: REPO_URL ? [{ icon: 'github', link: REPO_URL }] : [],
    footer: {
      message: 'Pre-release. Nothing on this site is ready for production use yet. Released under the MIT License.',
    },
  },
});
