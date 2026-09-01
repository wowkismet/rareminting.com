/**
 * Migration runner.
 *
 * `apply.ts` builds a throwaway schema in PGlite for tests. This applies the
 * same files to a real, persistent database, exactly once each, and is what
 * runs on the server during a deploy.
 *
 * Two properties matter for something that runs unattended on every deploy:
 *
 *  - **Idempotent.** Applied filenames are recorded in `schema_migrations`, so
 *    re-running is a no-op. A deploy can be repeated safely.
 *  - **Atomic per file.** Each migration runs inside its own transaction, so a
 *    failure halfway through leaves that file entirely unapplied rather than
 *    half-applied, which is the state that is genuinely painful to recover.
 *
 * It also refuses to run a file whose contents changed after being applied —
 * silently diverging from what is recorded is worse than stopping.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');

/**
 * Minimal shape shared by `pg.Client` and PGlite, so this is testable.
 *
 * `exec` and `query` are separate deliberately. A migration file holds many
 * statements, and the extended query protocol — the one that accepts
 * parameters — permits only a single command per call. Each driver has its own
 * multi-statement path: `pg` uses the simple protocol when given no parameters,
 * PGlite exposes `exec`.
 */
export interface MigrationClient {
  /** Run one or more statements. No parameters. */
  exec(sql: string): Promise<void>;
  /** Run a single parameterised statement. */
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Adapt a `pg.Client`-shaped object. */
export function fromPgClient(client: {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}): MigrationClient {
  return {
    exec: async (sql) => {
      // No parameters, so `pg` uses the simple protocol and accepts multiple
      // commands in one round trip.
      await client.query(sql);
    },
    query: (sql, params) => client.query(sql, params),
  };
}

/** Adapt a PGlite instance. */
export function fromPglite(db: {
  exec(sql: string): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}): MigrationClient {
  return {
    exec: async (sql) => {
      await db.exec(sql);
    },
    query: (sql, params) => db.query(sql, params),
  };
}

export interface AppliedMigration {
  readonly file: string;
  readonly skipped: boolean;
  readonly ms: number;
}

function checksum(sql: string): string {
  // Normalise line endings first: a checkout on Windows would otherwise
  // disagree with one on Linux about every single file.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}

export async function migrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

export async function migrate(
  client: MigrationClient,
  options: { readonly log?: (message: string) => void } = {},
): Promise<AppliedMigration[]> {
  const log = options.log ?? (() => {});

  await client.exec(`
    create table if not exists schema_migrations (
      file        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )
  `);

  const existing = await client.query(`select file, checksum from schema_migrations`);
  const applied = new Map<string, string>();
  for (const row of existing.rows as { file: string; checksum: string }[]) {
    applied.set(row.file, row.checksum);
  }

  const results: AppliedMigration[] = [];

  for (const file of await migrationFiles()) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const sum = checksum(sql);
    const previous = applied.get(file);

    if (previous !== undefined) {
      if (previous !== sum) {
        throw new Error(
          `Migration ${file} has changed since it was applied ` +
            `(recorded ${previous}, now ${sum}). Migrations are immutable once ` +
            `applied — add a new file instead of editing this one.`,
        );
      }
      results.push({ file, skipped: true, ms: 0 });
      log(`  ${file.padEnd(28)} already applied`);
      continue;
    }

    const started = Date.now();
    try {
      await client.exec('begin');
      await client.exec(sql);
      await client.query(`insert into schema_migrations (file, checksum) values ($1, $2)`, [
        file,
        sum,
      ]);
      await client.exec('commit');
    } catch (error) {
      await client.exec('rollback').catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${file} failed and was rolled back: ${message}`, {
        cause: error,
      });
    }

    const ms = Date.now() - started;
    results.push({ file, skipped: false, ms });
    log(`  ${file.padEnd(28)} applied in ${ms}ms`);
  }

  return results;
}

/** `node src/migrate.ts` — applies pending migrations to DATABASE_URL. */
async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const { Client } = await import('pg');
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const results = await migrate(fromPgClient(client), { log: (m) => console.log(m) });
    const fresh = results.filter((r) => !r.skipped).length;
    console.log(
      fresh === 0
        ? `\nSchema already up to date (${results.length} migrations).`
        : `\nApplied ${fresh} migration${fresh === 1 ? '' : 's'}.`,
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1])) {
  await main();
}
