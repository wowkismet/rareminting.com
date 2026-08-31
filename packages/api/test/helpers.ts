import { PGlite } from '@electric-sql/pglite';
import { createSchema } from '@rareminting/db/src/apply.ts';

import { createApp, type App } from '../src/app.ts';
import type { Database, Db } from '../src/db.ts';

/**
 * A test rig backed by real PostgreSQL.
 *
 * PGlite is PostgreSQL compiled to WASM, so constraints, triggers and SQL all
 * behave exactly as they will in production — with no server, no port and no
 * teardown to get wrong.
 */

// scrypt is deliberately slow. Lower the cost so the suite stays quick; this is
// the only place it is reduced.
process.env['PASSWORD_SCRYPT_N'] = String(2 ** 14);

export interface Rig {
  readonly pg: PGlite;
  readonly db: Database;
  readonly app: App;
}

/** Adapt PGlite to the Database interface, including real transactions. */
export function adapt(pg: PGlite): Database {
  return {
    query<R>(sql: string, params?: readonly unknown[]) {
      return pg.query<R>(sql, params === undefined ? undefined : [...params]) as Promise<{
        rows: R[];
      }>;
    },
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return pg.transaction(async (tx) => {
        const wrapped: Db = {
          query<R>(sql: string, params?: readonly unknown[]) {
            return tx.query<R>(sql, params === undefined ? undefined : [...params]) as Promise<{
              rows: R[];
            }>;
          },
        };
        return fn(wrapped);
      }) as Promise<T>;
    },
  };
}

export async function createRig(): Promise<Rig> {
  const { db: pg } = await createSchema();
  const db = adapt(pg);
  return { pg, db, app: createApp(db) };
}

/**
 * Reset between tests.
 *
 * audit_logs is append-only by trigger, so it is truncated rather than deleted.
 * pattern_tags is reference data seeded by migration and must survive.
 */
export async function reset(pg: PGlite): Promise<void> {
  await pg.exec(`
    truncate login_attempts, sessions, user_roles, audit_logs,
             date_matches, listing_pattern_tags, notes, listings, sellers
      restart identity cascade;
    delete from users;
  `);
}

export const TEST_IP = '203.0.113.7';

export function request(
  app: App,
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;

  return app.handle(
    new Request(`http://api.test${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    TEST_IP,
  );
}
