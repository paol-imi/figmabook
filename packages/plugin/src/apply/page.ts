import type { FigmaPort } from '../port';

/** The page Holotype builds components on (11 §7.1, D-22). */
export const COMPONENTS_PAGE = 'Components';

/**
 * The "Components" page, created at the end of the document when absent, and loaded:
 * under `documentAccess: "dynamic-page"` a page's children are usable only once loaded.
 * Creating the page is the first write of an import (09 §5.1 "Pages").
 */
export async function ensureComponentsPage(port: Pick<FigmaPort, 'root' | 'createPage'>): Promise<PageNode> {
  let page = port.root.children.find((child) => child.name === COMPONENTS_PAGE);
  if (page === undefined) {
    page = port.createPage();
    page.name = COMPONENTS_PAGE;
  }
  await page.loadAsync();
  return page;
}
