/**
 * Grant a role to an account by email.
 *
 *   DATABASE_URL=... node src/grant-role.ts someone@example.com admin
 *
 * The first admin has to be created out of band — there is no way to make one
 * through the console, because doing so would mean an unauthenticated route
 * that hands out admin. Run this once on the server; every later grant can be
 * done by that admin.
 */

import path from 'node:path';

const VALID = ['buyer', 'seller', 'admin', 'support', 'grievance_officer'];

async function main(): Promise<void> {
  const [email, role] = process.argv.slice(2);

  if (email === undefined || role === undefined) {
    console.error('usage: node src/grant-role.ts <email> <role>');
    console.error(`roles: ${VALID.join(', ')}`);
    process.exit(1);
  }
  if (!VALID.includes(role)) {
    console.error(`Unknown role "${role}". Valid: ${VALID.join(', ')}`);
    process.exit(1);
  }

  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const { Client } = await import('pg');
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const found = await client.query<{ id: string }>(
      `select id from users where lower(email) = lower($1)`,
      [email],
    );
    const user = found.rows[0];
    if (user === undefined) {
      console.error(`No account for ${email}. Create it on the site first.`);
      process.exit(1);
    }

    await client.query(
      `insert into user_roles (user_id, role) values ($1, $2::user_role)
       on conflict (user_id, role) do nothing`,
      [user.id, role],
    );

    const roles = await client.query<{ role: string }>(
      `select role from user_roles where user_id = $1 order by role`,
      [user.id],
    );
    console.log(`${email} now has: ${roles.rows.map((r) => r.role).join(', ')}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1])) {
  await main();
}
