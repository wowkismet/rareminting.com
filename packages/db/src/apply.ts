/**
 * Apply every migration, in order, to a PGlite database.
 *
 * PGlite is real PostgreSQL compiled to WASM, so this is not a syntax check —
 * the schema genuinely executes, constraints genuinely fire, and triggers
 * genuinely run. That makes the migrations verifiable on any machine with Node
 * and no database server installed.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');

export interface AppliedMigration {
  readonly file: string;
  readonly statements: number;
  readonly ms: number;
}

/** Migration filenames in lexical order, which is also apply order. */
export async function migrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

/**
 * Rough statement count, for reporting only. Splitting SQL properly requires a
 * parser; the whole file is handed to Postgres in one `exec` regardless.
 */
function countStatements(sql: string): number {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .filter((chunk) => chunk.trim().length > 0).length;
}

/** Create a fresh in-memory database with the full schema applied. */
export async function createSchema(): Promise<{
  db: PGlite;
  applied: AppliedMigration[];
}> {
  const db = await PGlite.create();
  const applied: AppliedMigration[] = [];

  for (const file of await migrationFiles()) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const started = performance.now();
    try {
      await db.exec(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${file} failed: ${message}`, { cause: error });
    }
    applied.push({
      file,
      statements: countStatements(sql),
      ms: Math.round(performance.now() - started),
    });
  }

  return { db, applied };
}

/** `npm run migrate:check` — apply everything and print what landed. */
async function main(): Promise<void> {
  const { db, applied } = await createSchema();

  for (const row of applied) {
    console.log(`  ${row.file.padEnd(24)} ${String(row.statements).padStart(3)} stmts  ${row.ms}ms`);
  }

  const tables = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  const enums = await db.query<{ typname: string }>(
    `select typname from pg_type where typtype = 'e' order by typname`,
  );
  const indexes = await db.query<{ count: string }>(
    `select count(*)::text as count from pg_indexes where schemaname = 'public'`,
  );
  const constraints = await db.query<{ count: string }>(
    `select count(*)::text as count from pg_constraint`,
  );

  console.log(`\n  tables:      ${tables.rows.length}`);
  console.log(`  enum types:  ${enums.rows.length}`);
  console.log(`  indexes:     ${indexes.rows[0]?.count ?? '?'}`);
  console.log(`  constraints: ${constraints.rows[0]?.count ?? '?'}`);
  console.log(`\n  ${tables.rows.map((r) => r.table_name).join(', ')}`);

  await db.close();
}

if (process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1])) {
  await main();
}
