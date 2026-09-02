/**
 * Process entry point.
 *
 * Owns the database pool, the port and the shutdown signals. The socket-level
 * translation lives in node-adapter.ts, where it can be tested.
 */

import { Pool } from 'pg';

import { createApp } from './app.ts';
import { createNodeServer } from './node-adapter.ts';
import type { Database, Db } from './db.ts';

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

  const server = createNodeServer(app, origin);

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
