import { PGlite } from '@electric-sql/pglite';
import { createSchema } from '@rareminting/db/src/apply.ts';

import { verhoeffValid } from '@rareminting/config';

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

// Identity numbers are stored as HMACs and the service refuses to run without
// a key. This one is for tests only and never leaves this file.
process.env['KYC_NUMBER_PEPPER'] = 'test-pepper-not-for-production-use-0123456789';

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
             date_matches, listing_pattern_tags, notes, listings,
             kyc_documents, otp_challenges, sellers
      restart identity cascade;
    delete from users;
  `);
}

export const TEST_IP = '203.0.113.7';

/* ------------------------- seller registration ------------------------- */

let identityCounter = 0;

/**
 * A registration body with identity numbers that are structurally valid and
 * unique per call.
 *
 * Unique matters: one PAN registers one seller, so a fixed pair would make the
 * second registration in any test collide with the first. Every number here is
 * synthetic — the Aadhaar is an arbitrary prefix with whichever check digit
 * makes Verhoeff pass.
 */
export function sellerBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  identityCounter += 1;
  const n = identityCounter;

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letter = (i: number): string => letters.charAt(i % 26);
  // [A-Z]{3} P [A-Z] [0-9]{4} [A-Z] — the fourth character must be P for an
  // individual, the fifth is the surname initial.
  const pan = `A${letter(n)}${letter(n * 3)}PK${String(1000 + (n % 9000)).padStart(4, '0')}${letter(n * 7)}`;

  const prefix = `2${String(n).padStart(4, '0')}567890`.slice(0, 11);
  let aadhaar = '';
  for (let d = 0; d < 10; d += 1) {
    if (verhoeffValid(`${prefix}${d}`)) {
      aadhaar = `${prefix}${d}`;
      break;
    }
  }
  if (aadhaar === '') throw new Error(`no check digit completes ${prefix}`);

  const mobile = `9${String(800000000 + n).slice(0, 9)}`;

  return {
    fullName: 'Kavya Kapoor',
    mobile,
    pan,
    aadhaar,
    ...overrides,
  };
}

/** Register the token's account as a seller, and assert it worked. */
export async function becomeSeller(
  app: App,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Response> {
  return request(app, 'POST', '/v1/sellers', { token, body: sellerBody(overrides) });
}

/** Approve a seller directly, for tests about what approval unlocks. */
export async function approveSeller(pg: PGlite, sellerId: string): Promise<void> {
  await pg.query(
    `update sellers set kyc_state = 'verified', kyc_verified_at = now(),
            is_minting_verified = true
      where id = $1`,
    [sellerId],
  );
}

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
