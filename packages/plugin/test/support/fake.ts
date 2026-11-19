/*
 * `@holotype/figma-fake` from source. It cannot be a devDependency: figma-fake depends on
 * this package for the `FigmaPort` type, and Turborepo refuses the package cycle. The import
 * is test-only; `src/` never sees the fake.
 */
export {
  createFakeFigma,
  DEFAULT_FONTS,
  type FakeFigma,
  type FakeFigmaOptions,
  type Op,
} from '../../../figma-fake/src/index';
