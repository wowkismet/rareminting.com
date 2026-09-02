/**
 * node:http <-> web-standard translation.
 *
 * Split out of server.ts so it can be tested. server.ts calls main() at module
 * scope, so importing it would open a socket and demand a DATABASE_URL; this
 * file is inert on import and holds the whole translation layer.
 *
 * This is the only layer that never runs in the route tests — those hand a
 * Request straight to app.handle(). Anything wrong here is therefore invisible
 * until deployment, which is precisely why it has its own tests.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { App } from './app.ts';
import { clientIp } from './http.ts';

/**
 * Read the body up front rather than handing the socket over as a stream.
 *
 * A streamed Request body needs `duplex: 'half'`, and consumers that rewind or
 * read it more than once — multipart parsing among them — behave differently
 * depending on the runtime. Uploads are capped well below memory pressure, so
 * buffering trades nothing for a body that behaves identically everywhere.
 */
async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return null;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

export async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const url = new URL(req.url ?? '/', origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    // HTTP/2 pseudo-headers are not valid in a Headers object.
    if (key.startsWith(':')) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }

  const body = await readBody(req);

  return new Request(url, {
    method: req.method ?? 'GET',
    headers,
    ...(body === null || body.length === 0 ? {} : { body: new Uint8Array(body) }),
  });
}

export async function send(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  // Several Set-Cookie headers must stay several headers, not one joined
  // string, or every cookie after the first is lost.
  const cookies = response.headers.getSetCookie();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    headers[key] = value;
  });
  if (cookies.length > 0) headers['set-cookie'] = cookies;

  res.writeHead(response.status, headers);
  if (response.body === null) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Wire an App to a node:http server. Does not listen. */
export function createNodeServer(app: App, origin: string): Server {
  return createServer((req, res) => {
    toRequest(req, origin)
      .then(async (request) => {
        const ip = clientIp(request, req.socket.remoteAddress ?? null);
        return send(res, await app.handle(request, ip));
      })
      .catch((error: unknown) => {
        console.error('[api] adapter failure:', error);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"internal_error"}');
      });
  });
}
