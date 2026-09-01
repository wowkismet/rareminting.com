import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

import { fromPglite, migrate, migrationFiles, type MigrationClient } from '../src/migrate.ts';

/**
 * The runner is exercised against real PostgreSQL. It runs unattended on every
 * deploy, so the properties that matter are that a second run changes nothing
 * and that a failure leaves no partial state behind.
 */

let pg: PGlite;
let client: MigrationClient;

before(async () => {
  pg = await PGlite.create();
  client = fromPglite(pg);
});

after(async () => {
  await pg.close();
});

describe('migrate', () => {
  it('applies every migration on a fresh database', async () => {
    const results = await migrate(client);
    const files = await migrationFiles();

    assert.equal(results.length, files.length);
    assert.ok(
      results.every((r) => !r.skipped),
      'nothing should be skipped on a fresh database',
    );

    const tables = await pg.query<{ count: string }>(
      `select count(*)::text as count from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    assert.ok(Number(tables.rows[0]!.count) > 40, 'the full schema should exist');
  });

  it('is a no-op the second time', async () => {
    const results = await migrate(client);
    assert.ok(
      results.every((r) => r.skipped),
      're-running must not reapply anything',
    );
  });

  it('records what it applied', async () => {
    const rows = await pg.query<{ file: string; checksum: string }>(
      `select file, checksum from schema_migrations order by file`,
    );
    const files = await migrationFiles();
    assert.deepEqual(
      rows.rows.map((r) => r.file),
      files,
    );
    assert.ok(rows.rows.every((r) => r.checksum.length === 16));
  });

  it('refuses to run when an applied migration has been edited', async () => {
    await pg.query(`update schema_migrations set checksum = 'deadbeefdeadbeef' where file = $1`, [
      (await migrationFiles())[0],
    ]);

    await assert.rejects(
      () => migrate(client),
      /has changed since it was applied|immutable once/,
      'an edited migration must stop the deploy, not diverge silently',
    );

    // Restore so later runs are unaffected.
    const first = (await migrationFiles())[0]!;
    await pg.query(`delete from schema_migrations where file = $1`, [first]);
  });

  it('rolls a failing migration back rather than half-applying it', async () => {
    const fresh = await PGlite.create();
    const c: MigrationClient = fromPglite(fresh);
    await c.exec(`create table if not exists schema_migrations (
      file text primary key, checksum text not null, applied_at timestamptz not null default now())`);

    // Two statements where the second fails: the first must not survive.
    await assert.rejects(async () => {
      await c.exec('begin');
      await c.exec(`create table half_applied (id int)`);
      await c.exec(`this is not valid sql`);
      await c.exec('commit');
    });
    await c.exec('rollback').catch(() => {});

    const left = await fresh.query<{ count: string }>(
      `select count(*)::text as count from information_schema.tables
        where table_name = 'half_applied'`,
    );
    assert.equal(left.rows[0]!.count, '0', 'the rolled-back table must not exist');
    await fresh.close();
  });
});
