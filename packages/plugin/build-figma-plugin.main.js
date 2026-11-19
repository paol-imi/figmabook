// create-figma-plugin build hook: bundle workspace packages from source (the
// `@holotype/source` export condition) so esbuild can tree-shake them per module.
export default function (buildOptions) {
  return { ...buildOptions, conditions: ['@holotype/source'] };
}
