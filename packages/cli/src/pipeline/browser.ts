import type { Page } from 'playwright';

/** The URL pattern of the favicon Chromium fetches on its own for a top-level page. */
export const FAVICON_PATTERN = '**/favicon.ico';

/**
 * Answers Chromium's own `/favicon.ico` request with an empty 204. A Storybook build has no
 * such file, so the 404 would be logged as a console error (`SB_CONSOLE_ERROR`) on whichever
 * story a worker renders first: noise that is not the story's, and that would make
 * `report.json` differ between runs.
 */
export async function quietFavicon(page: Pick<Page, 'route'>): Promise<void> {
  await page.route(FAVICON_PATTERN, (route) => route.fulfill({ status: 204, body: '' }));
}
