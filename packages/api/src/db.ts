/**
 * Database access.
 *
 * The API talks to a narrow `Db` interface rather than to `pg` directly. Both
 * `pg.Pool` and PGlite already satisfy it, which is what lets the test suite run
 * the real schema and the real queries against real PostgreSQL (compiled to
 * WASM) with no database server installed anywhere.
 */

export interface QueryResult<R> {
  readonly rows: R[];
}

export interface Db {
  query<R>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>>;
}

/** A `Db` that can also run a set of statements atomically. */
export interface TransactionalDb extends Db {
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

/**
 * Wrap a plain `Db` with BEGIN/COMMIT/ROLLBACK.
 *
 * Note this serialises on a single connection, which is correct for PGlite and
 * for a dedicated pg client, but a `pg.Pool` must hand over a checked-out
 * client rather than the pool itself — see `pooledTransaction`.
 */
export function withTransaction(db: Db): TransactionalDb {
  return {
    query: db.query.bind(db),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      await db.query('begin');
      try {
        const result = await fn(db);
        await db.query('commit');
        return result;
      } catch (error) {
        await db.query('rollback');
        throw error;
      }
    },
  };
}

/** Single row or null, for queries that must not return more than one. */
export function one<R>(result: QueryResult<R>): R | null {
  return result.rows[0] ?? null;
}

/** Single row, throwing when absent. Use only where absence is a bug. */
export function exactlyOne<R>(result: QueryResult<R>): R {
  const row = result.rows[0];
  if (row === undefined) throw new Error('expected exactly one row, got none');
  return row;
}
