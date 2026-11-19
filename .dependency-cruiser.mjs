/**
 * Package boundaries (02 §6.2), checked by `pnpm check:deps` in CI.
 * Workspace imports resolve to source through the `@holotype/source` export condition,
 * so a boundary violation shows up as an edge between two `packages/<name>/` paths.
 */

/** Workspace packages each package's `src/` may import (README §6, 02 §6.2). */
const allowed = {
  shared: [],
  ir: ['shared'],
  'layout-sim': ['ir', 'shared'],
  mapper: ['layout-sim', 'ir', 'shared'],
  dcr: ['ir', 'shared'],
  storybook: ['ir', 'shared'],
  capture: ['storybook', 'ir', 'shared'],
  planner: ['storybook', 'ir', 'shared'],
  plugin: ['layout-sim', 'ir', 'shared'],
  'figma-fake': ['layout-sim', 'ir', 'shared', 'plugin'],
  cli: ['shared', 'ir', 'layout-sim', 'mapper', 'dcr', 'storybook', 'capture', 'planner'],
  'storybook-addon': ['ir', 'shared', 'capture'],
  action: ['cli', 'shared'],
  'vite-plugin': ['shared'],
  fidelity: ['ir', 'shared'],
  'diag-gen': [],
};

const tools = new Set(['fidelity', 'diag-gen']);
const dirOf = (name) => (tools.has(name) ? `tools/${name}` : `packages/${name}`);
const src = (name) => `^${dirOf(name)}/src/`;
const workspace = (names) => `^(${names.map(dirOf).join('|')})/`;

/** Isomorphic packages (02 §6.2 browser-safe set) and the npm packages they may use. */
const isomorphic = {
  shared: [],
  ir: ['@sinclair/typebox', '@noble/hashes'],
  'layout-sim': [],
  mapper: [],
  dcr: [],
  plugin: ['preact', '@create-figma-plugin/ui', '@create-figma-plugin/utilities', 'fflate'],
};

const boundaryRules = Object.entries(allowed).map(([name, deps]) => ({
  name: `boundary-${name}`,
  comment: `${name} may import only: ${deps.join(', ') || 'no workspace package'} (02 §6.2).`,
  severity: 'error',
  from: { path: src(name) },
  to: { path: '^(packages|tools)/', pathNot: workspace([name, ...deps]) },
}));

const isomorphicRules = Object.entries(isomorphic).flatMap(([name, npm]) => [
  {
    name: `isomorphic-${name}-no-node`,
    comment: `${name} runs everywhere: no Node built-ins (02 §7).`,
    severity: 'error',
    from: { path: src(name) },
    to: { dependencyTypes: ['core'] },
  },
  {
    name: `isomorphic-${name}-npm`,
    comment: `${name} may use only these npm packages: ${npm.join(', ') || 'none'} (02 §6.1).`,
    severity: 'error',
    from: { path: src(name) },
    to: {
      dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'],
      pathNot: [`^(packages|tools)/`, ...npm.map((pkg) => `node_modules/${pkg}/`)],
    },
  },
]);

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    ...boundaryRules,
    ...isomorphicRules,
    {
      name: 'type-only-planner-storybook',
      comment: 'planner uses storybook types only (02 §6.2).',
      severity: 'error',
      from: { path: src('planner') },
      to: { path: '^packages/storybook/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'type-only-figma-fake-plugin',
      comment: 'figma-fake may import only the FigmaPort type from plugin (02 §6.2).',
      severity: 'error',
      from: { path: src('figma-fake') },
      to: { path: '^packages/plugin/', pathNot: '^packages/plugin/src/port\\.ts$' },
    },
    {
      name: 'type-only-figma-fake-port',
      severity: 'error',
      from: { path: src('figma-fake') },
      to: { path: '^packages/plugin/src/port\\.ts$', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'storybook-addon-serializer-only',
      comment: 'storybook-addon reuses the built serializer string from capture, nothing else (02 §6.1).',
      severity: 'error',
      from: { path: src('storybook-addon') },
      to: { path: '^packages/capture/', pathNot: '^packages/capture/src/serializer-source\\.ts$' },
    },
    {
      name: 'type-only-storybook-addon-ir',
      comment: 'storybook-addon uses ir types only (02 §6.2).',
      severity: 'error',
      from: { path: src('storybook-addon') },
      to: { path: '^packages/ir/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'serializer-self-contained',
      comment: 'The in-page serializer imports only its own folder plus ir types (02 §6.2).',
      severity: 'error',
      from: { path: '^packages/capture/src/page/' },
      to: { pathNot: ['^packages/capture/src/page/', '^packages/ir/'] },
    },
    {
      name: 'serializer-ir-types-only',
      severity: 'error',
      from: { path: '^packages/capture/src/page/' },
      to: { path: '^packages/ir/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Every import resolves (virtual modules are provided by build plugins).',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true, pathNot: '^virtual:' },
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Published code must not import devDependencies.',
      severity: 'error',
      from: { path: '^(packages|tools)/[^/]+/src/' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-non-package-json',
      comment: 'Every npm import in src/ is declared in its package.json (tests and configs use root tooling).',
      severity: 'error',
      from: { path: '^(packages|tools)/[^/]+/src/' },
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
  ],
  options: {
    exclude: { path: '^(packages|tools)/[^/]+/(dist|build)/' },
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['@holotype/source', 'types', 'import', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.d.ts', '.js', '.mjs', '.json'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
