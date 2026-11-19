import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import sirv from 'sirv';

export interface StaticServer {
  /** Base URL with a trailing slash, always on `127.0.0.1`. */
  readonly url: string;
  /** Stops the server and drops open keep-alive connections. Idempotent. */
  close(): Promise<void>;
}

/**
 * Serves a static Storybook build read-only on `127.0.0.1` at an ephemeral port (03 §9.1).
 * `file://` is never used: it breaks ES modules in Vite builds. Unknown paths are 404.
 */
export async function startStaticServer(dir: string): Promise<StaticServer> {
  const serve = sirv(dir, { dev: false, etag: true, dotfiles: false });
  const server = createServer((req, res) => {
    serve(req, res, () => {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
