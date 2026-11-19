/**
 * `FigmaPort`: the narrow seam between the applier and the Plugin API (09 §4).
 *
 * It is a `Pick<>` of the official typings (`@figma/plugin-typings@1.142.0`), so production
 * binds the real `figma` object with no glue code, and `@holotype/figma-fake` is type-checked
 * against Figma's own definitions: `createFakeFigma()` must satisfy this type with no casts.
 *
 * The port grows additively (BUILD §2.3): each fake item adds the members it needs.
 * B-06 holds the "Global" row of BUILD §8.1; node members (BaseNode … Text rows) come with
 * the node types these functions return. B-54 adds `createComponentFromNode` (09 §4, icon
 * extraction from SVG frames, 09 §6.2) and the variables subset of BUILD §8.1. The rest of
 * 09 §4 (styles, library imports, `teamLibrary`, modes) is added by B-139 and B-142 together
 * with its fake.
 */
export type FigmaPort = Pick<
  PluginAPI,
  // Node creation (BUILD §8.1 "Global").
  | 'createFrame'
  | 'createComponent'
  | 'createText'
  | 'createRectangle'
  | 'createEllipse'
  | 'createVector'
  | 'createNodeFromSvg'
  | 'createPage'
  | 'createSection'
  | 'combineAsVariants'
  | 'createComponentFromNode'
  // Images (09 §6.3).
  | 'createImage'
  | 'getImageByHash'
  // Document access under `documentAccess: "dynamic-page"` (async getters only, 09 §6.2).
  | 'getNodeByIdAsync'
  | 'root'
  | 'currentPage'
  | 'setCurrentPageAsync'
  | 'skipInvisibleInstanceChildren'
  | 'fileKey'
  // Fonts (09 §5.1 preflight).
  | 'loadFontAsync'
  | 'listAvailableFontsAsync'
  // Session.
  | 'commitUndo'
  | 'notify'
  | 'mixed'
> & {
  /** Local variables, one mode per collection (BUILD §8.1 "Variables (subset)", 08 §8). */
  variables: Pick<
    VariablesAPI,
    | 'createVariableCollection'
    | 'createVariable'
    | 'createVariableAlias'
    | 'getLocalVariablesAsync'
    | 'getLocalVariableCollectionsAsync'
    | 'getVariableByIdAsync'
    | 'setBoundVariableForPaint'
  >;
  clientStorage: Pick<ClientStorageAPI, 'getAsync' | 'setAsync'>;
};
