import type { Page, Route } from 'playwright';
import { describe, expect, it } from 'vitest';
import { FAVICON_PATTERN, quietFavicon } from '../src';

describe('quietFavicon', () => {
  it('answers /favicon.ico with an empty 204', async () => {
    const routes: Array<{ pattern: unknown; handler: (route: Route) => unknown }> = [];
    const page = {
      route: async (pattern: unknown, handler: (route: Route) => unknown) => {
        routes.push({ pattern, handler });
      },
    } as unknown as Pick<Page, 'route'>;
    await quietFavicon(page);
    expect(routes.map((r) => r.pattern)).toEqual([FAVICON_PATTERN]);
    const fulfilled: unknown[] = [];
    await routes[0]?.handler({ fulfill: async (response: unknown) => fulfilled.push(response) } as unknown as Route);
    expect(fulfilled).toEqual([{ status: 204, body: '' }]);
  });
});
