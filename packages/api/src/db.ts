/**
 * Database access.
 *
 * The API talks to a narrow interface rather than to `pg` directly. Both
 * `pg.Pool` and PGlite are adapted to it, which is what lets the test suite run
 * the real schema and the real queries against real PostgreSQL (compiled to
 * WASM) with no database server installed anywhere.
 */

export interface QueryResult<R> {
  readonly rows: R[];
}

export interface Db {
  query<R>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>>;
}

/**
 * A `Db` that can run work atomically.
 *
 * Separate from `Db` on purpose: a transaction must run every statement on one
 * connection. Emitting BEGIN/COMMIT as ordinary queries against a pool would
 * scatter them across different connections and silently fail to isolate
 * anything — a bug that only shows up under concurrency.
 */
export interface Database extends Db {
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

/** Single row or null, for queries that may return nothing. */
export function one<R>(result: QueryResult<R>): R | null {
  return result.rows[0] ?? null;
}

/** Single row, throwing when absent. Use only where absence is a bug. */
export function exactlyOne<R>(result: QueryResult<R>): R {
  const row = result.rows[0];
  if (row === undefined) throw new Error('expected exactly one row, got none');
  return row;
}

/** PostgreSQL error codes worth branching on. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_CHECK_VIOLATION = '23514';
export const PG_FK_VIOLATION = '23503';

export function pgErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Name of the constraint a violation came from, when the driver reports it. */
export function pgConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const named = (error as { constraint?: unknown }).constraint;
  if (typeof named === 'string') return named;
  // PGlite surfaces it in the message rather than a field.
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return null;
  const match = /constraint "([^"]+)"/.exec(message);
  return match?.[1] ?? null;
}
