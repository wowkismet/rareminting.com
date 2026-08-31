/**
 * node:http adapter.
 *
 * The only file that knows about sockets. Everything else works in terms of
 * Request and Response.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Pool } from 'pg';

import { createApp } from './app.ts';
import { clientIp } from './http.ts';
import type { Database, Db } from './db.ts';

function toRequest(req: IncomingMessage, origin: string): Request {
  const url = new URL(req.url ?? '/', origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';

  return new Request(url, {
    method,
    headers,
    ...(hasBody
      ? {
          body: req as unknown as ReadableStream,
          duplex: 'half',
        }
      : {}),
  } as RequestInit);
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  if (response.body === null) {
    res.end();
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  const db: Database = {
    // pg types rows as QueryResultRow; the caller declares the shape it expects,
    // which is exactly the boundary where that assertion belongs.
    async query<R>(sql: string, params?: readonly unknown[]) {
      const result = await pool.query(sql, params === undefined ? undefined : [...params]);
      return { rows: result.rows as R[] };
    },
    // A transaction must hold one connection for its whole life. Issuing
    // BEGIN/COMMIT through the pool would spread them over different
    // connections and isolate nothing.
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const tx: Db = {
        async query<R>(sql: string, params?: readonly unknown[]) {
          const result = await client.query(sql, params === undefined ? undefined : [...params]);
          return { rows: result.rows as R[] };
        },
      };
      try {
        await client.query('begin');
        const result = await fn(tx);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };

  const app = createApp(db);
  const port = Number(process.env['PORT'] ?? 4000);
  const host = process.env['HOST'] ?? '127.0.0.1';
  const origin = `http://${host}:${port}`;

  const server = createServer((req, res) => {
    const request = toRequest(req, origin);
    const ip = clientIp(request, req.socket.remoteAddress ?? null);
    app
      .handle(request, ip)
      .then((response) => send(res, response))
      .catch((error: unknown) => {
        console.error('[api] adapter failure:', error);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"internal_error"}');
      });
  });

  const shutdown = (signal: string): void => {
    console.log(`[api] ${signal} received, closing`);
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  server.listen(port, host, () => {
    console.log(`[api] listening on ${origin}`);
  });
}

await main();
