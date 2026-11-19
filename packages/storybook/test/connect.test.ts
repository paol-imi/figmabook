import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Diagnostic } from '@holotype/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { type ConnectedStorybook, connectStorybook, startStaticServer } from '../src';
import { fixtureDir } from './support';

const open: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((item) => item.close()));
});

async function connected(source: Parameters<typeof connectStorybook>[0]): Promise<ConnectedStorybook> {
  const result = await connectStorybook(source);
  if (!result.ok) throw new Error(`connect failed: ${JSON.stringify(result.error)}`);
  open.push(result.value);
  return result.value;
}

async function failure(source: Parameters<typeof connectStorybook>[0]): Promise<Diagnostic> {
  const result = await connectStorybook(source);
  if (result.ok) {
    open.push(result.value);
    throw new Error('expected connectStorybook to fail');
  }
  expect(result.error).toHaveLength(1);
  const [diagnostic] = result.error;
  if (diagnostic === undefined) throw new Error('no diagnostic');
  expect(diagnostic.severity).toBe('fatal');
  expect(diagnostic.data).toMatchObject({ fatal: true });
  return diagnostic;
}

/** A loopback server answering from a route table, for hosts a static build cannot imitate. */
async function serve(listener: RequestListener): Promise<string> {
  const server: Server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  open.push({
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

describe('connectStorybook: static build (03 §9.1)', () => {
  it('serves the recorded Storybook 10 build and fills the model', async () => {
    const storybook = await connected({ source: { kind: 'static', dir: fixtureDir('sb10-ds-react') } });
    expect(storybook.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(storybook.caps).toMatchObject({ version: '10.6.7', indexFormat: 'v5', storyFinishedEvent: true });
    expect(storybook.diagnostics).toEqual([]);
    const stories = await storybook.listStories();
    expect(stories).toHaveLength(52);
    expect(stories).toBe(storybook.model.stories);
    expect(storybook.model).toMatchObject({
      baseUrl: storybook.baseUrl,
      excluded: [{ id: 'components-icon--gallery', title: 'Components/Icon', reason: 'tag-opt-out' }],
    });
    expect(storybook.model).not.toHaveProperty('defaultStoryId');
  });

  it('gives a stable index hash that changes with the filter', async () => {
    const dir = fixtureDir('sb10-ds-react');
    const first = await connected({ source: dir });
    const second = await connected({ source: { kind: 'static', dir } });
    const buttons = await connected({ source: dir, filter: { include: ['Components/Button'] } });
    expect(first.model.indexHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.model.indexHash).toBe(first.model.indexHash);
    expect(buttons.model.indexHash).not.toBe(first.model.indexHash);
    expect(buttons.model.stories.map((story) => story.sid)).toEqual(Array(8).fill('components-button'));
  });

  it('stops serving on close', async () => {
    const storybook = await connected({ source: fixtureDir('sb10-ds-react') });
    await storybook.close();
    await storybook.close();
    await expect(fetch(`${storybook.baseUrl}index.json`)).rejects.toThrow();
  });

  it('reads a v4 index without project.json with conservative capabilities', async () => {
    const storybook = await connected({ source: fixtureDir('sb8-index-v4') });
    expect(storybook.caps).toMatchObject({ version: null, indexFormat: 'v4', storyFinishedEvent: false });
    expect(storybook.model.stories.map((story) => story.id)).toEqual([
      'forms-input--default',
      'forms-input--disabled',
      'layout-grid--basic',
    ]);
  });

  it('warns SB_VERSION_UNTESTED on Storybook 11 and skips test entries', async () => {
    const storybook = await connected({ source: fixtureDir('sb11-beta') });
    expect(storybook.diagnostics.map((d) => d.code)).toEqual(['SB_VERSION_UNTESTED']);
    expect(storybook.caps).toMatchObject({ docgenServer: true, builder: 'vite' });
    expect(storybook.model.excluded).toEqual([
      { id: 'components-button--clicks', title: 'Components/Button', reason: 'test-entry' },
    ]);
  });

  it('fails with SB_INDEX_UNREACHABLE when the directory does not exist', async () => {
    const missing = join(fixtureDir('sb10-ds-react'), 'no-such-dir');
    const diagnostic = await failure({ source: missing });
    expect(diagnostic).toMatchObject({
      code: 'SB_INDEX_UNREACHABLE',
      message: `Could not load the Storybook index from ${missing}.`,
      data: { reason: 'the static build directory does not exist' },
    });
  });

  it('fails with SB_INDEX_UNREACHABLE when neither index.json nor stories.json is served', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'holotype-sb-empty-'));
    open.push({ close: () => rm(dir, { recursive: true, force: true }) });
    await writeFile(join(dir, 'iframe.html'), '<!doctype html>');
    const diagnostic = await failure({ source: dir });
    expect(diagnostic).toMatchObject({
      code: 'SB_INDEX_UNREACHABLE',
      data: { indexJson: 'HTTP 404', storiesJson: 'HTTP 404' },
    });
  });

  it('fails with SB_VERSION_UNSUPPORTED on a v3 stories.json and names the skipped stories', async () => {
    const diagnostic = await failure({ source: fixtureDir('sb6-stories-v3') });
    expect(diagnostic).toMatchObject({
      code: 'SB_VERSION_UNSUPPORTED',
      data: { skippedStories: ['example-button--primary', 'example-header--logged-in'] },
    });
  });

  it('fails with SB_VERSION_UNSUPPORTED on Storybook 7', async () => {
    const diagnostic = await failure({ source: fixtureDir('sb7-project') });
    expect(diagnostic).toMatchObject({ code: 'SB_VERSION_UNSUPPORTED', value: '7.6.24' });
  });

  it('fails with SB_IFRAME_UNREACHABLE without iframe.html', async () => {
    const diagnostic = await failure({ source: fixtureDir('no-iframe') });
    expect(diagnostic).toMatchObject({ code: 'SB_IFRAME_UNREACHABLE', data: { reason: 'HTTP 404' } });
  });
});

describe('connectStorybook: URL (03 §2.1, §9)', () => {
  it('connects to a served build and keeps a deep link as the default story', async () => {
    const server = await startStaticServer(fixtureDir('sb10-ds-react'));
    open.push(server);
    const storybook = await connected({
      source: `${server.url}index.html?path=/story/components-button--primary`,
    });
    expect(storybook.baseUrl).toBe(server.url);
    expect(storybook.model.defaultStoryId).toBe('components-button--primary');
    expect(storybook.model.stories).toHaveLength(52);
  });

  it('reads index.json, then falls back to stories.json', async () => {
    const requests: string[] = [];
    const url = await serve((req, res) => {
      requests.push(req.url ?? '');
      if (req.url === '/index.json') res.writeHead(500).end('oops');
      else res.writeHead(404).end();
    });
    const diagnostic = await failure({ source: url });
    expect(requests).toEqual(['/index.json', '/stories.json']);
    expect(diagnostic).toMatchObject({
      code: 'SB_INDEX_UNREACHABLE',
      value: `${url}index.json`,
      data: { indexJson: 'HTTP 500', storiesJson: 'HTTP 404' },
    });
  });

  it('explains an index.json that is not JSON', async () => {
    const url = await serve((req, res) => {
      if (req.url === '/index.json') res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
      else res.writeHead(404).end();
    });
    const diagnostic = await failure({ source: url });
    expect(diagnostic.data).toMatchObject({ indexJson: 'index.json is not a JSON object' });
  });

  it('fails with SB_INDEX_UNREACHABLE when nothing listens', async () => {
    const url = await serve((_req, res) => res.end());
    await Promise.all(open.splice(0).map((item) => item.close()));
    const diagnostic = await failure({ source: url, requestTimeoutMs: 2000 });
    expect(diagnostic.code).toBe('SB_INDEX_UNREACHABLE');
    expect(String(diagnostic.data?.indexJson)).toMatch(/fetch failed|ECONNREFUSED/);
  });

  it('fails with SB_INDEX_UNREACHABLE for a URL that is not http(s)', async () => {
    const diagnostic = await failure({ source: { kind: 'url', url: 'ftp://127.0.0.1/' } });
    expect(diagnostic).toMatchObject({
      code: 'SB_INDEX_UNREACHABLE',
      data: { reason: 'Not an http(s) URL: "ftp://127.0.0.1/".' },
    });
  });

  it('fails with SB_HOST_NOT_ALLOWED on the dev server host check', async () => {
    const url = await serve((_req, res) => res.writeHead(403, { 'content-type': 'text/plain' }).end('Invalid host'));
    const diagnostic = await failure({ source: url });
    expect(diagnostic).toMatchObject({ code: 'SB_HOST_NOT_ALLOWED', value: new URL(url).host });
  });

  it.each([401, 403])('fails with SB_AUTH_FAILED on HTTP %i', async (status) => {
    const url = await serve((_req, res) => res.writeHead(status).end('Forbidden'));
    const diagnostic = await failure({ source: url });
    expect(diagnostic).toMatchObject({ code: 'SB_AUTH_FAILED', data: { status } });
  });

  it('fails with SB_AUTH_REDIRECT when index.json redirects to a login page', async () => {
    const url = await serve((req, res) => {
      if (req.url === '/index.json') res.writeHead(302, { location: '/login' }).end();
      else res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<form>Sign in</form>');
    });
    const diagnostic = await failure({ source: url });
    expect(diagnostic.code).toBe('SB_AUTH_REDIRECT');
  });

  it('accepts a host without project.json', async () => {
    const index = JSON.stringify({ v: 5, entries: {} });
    const url = await serve((req, res) => {
      if (req.url === '/index.json') res.writeHead(200, { 'content-type': 'application/json' }).end(index);
      else if (req.url === '/iframe.html') res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
      else res.writeHead(404).end();
    });
    const storybook = await connected({ source: url });
    expect(storybook.caps.version).toBeNull();
    expect(storybook.model.stories).toEqual([]);
  });
});
