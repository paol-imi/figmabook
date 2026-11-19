/**
 * `FigmaPort`: the narrow seam between the applier and the Plugin API (09 §4). It is a
 * `Pick<>` of the official typings, so production binds the real `figma` object with no
 * glue code and `@holotype/figma-fake` is type-checked against Figma's own definitions.
 */
export type FigmaPort = Pick<
  PluginAPI,
  | 'createFrame'
  | 'createComponent'
  | 'createText'
  | 'createRectangle'
  | 'createEllipse'
  | 'createVector'
  | 'createNodeFromSvg'
  | 'createImage'
  | 'getImageByHash'
  | 'createPage'
  | 'createSection'
  | 'combineAsVariants'
  | 'loadFontAsync'
  | 'listAvailableFontsAsync'
  | 'getNodeByIdAsync'
  | 'commitUndo'
  | 'notify'
  | 'root'
  | 'currentPage'
  | 'setCurrentPageAsync'
  | 'mixed'
  | 'skipInvisibleInstanceChildren'
  | 'importComponentByKeyAsync'
  | 'importComponentSetByKeyAsync'
  | 'importStyleByKeyAsync'
  | 'createTextStyle'
  | 'createEffectStyle'
  | 'createPaintStyle'
  | 'getLocalTextStylesAsync'
  | 'getLocalEffectStylesAsync'
  | 'getLocalPaintStylesAsync'
> & {
  variables: Pick<
    VariablesAPI,
    | 'createVariableCollection'
    | 'createVariable'
    | 'createVariableAlias'
    | 'getLocalVariablesAsync'
    | 'getLocalVariableCollectionsAsync'
    | 'getVariableByIdAsync'
    | 'importVariableByKeyAsync'
    | 'setBoundVariableForPaint'
    | 'setBoundVariableForEffect'
  >;
  teamLibrary: Pick<TeamLibraryAPI, 'getAvailableLibraryVariableCollectionsAsync' | 'getVariablesInLibraryCollectionAsync'>;
  clientStorage: Pick<ClientStorageAPI, 'getAsync' | 'setAsync'>;
};
