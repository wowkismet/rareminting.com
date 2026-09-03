/**
 * Reconcile every outstanding order against the gateway.
 *
 * The route-level reconciler only runs when somebody opens an order, which is
 * fine for a buyer refreshing their own page and useless for an order nobody
 * happens to look at. This sweeps the lot, so a payment cannot sit unnoticed
 * because the one person who would have seen it was away.
 *
 * Worth running on a schedule. Safe to run at any time: every write is
 * conditional on the state it expects, so a payment already applied is skipped
 * and running twice changes nothing.
 *
 *   node src/reconcile-cli.ts            report only, changes nothing
 *   node src/reconcile-cli.ts --apply    apply what it finds
 */

import { Pool } from 'pg';

import { fetchOrderPayments, razorpayConfig } from './razorpay.ts';

interface PendingRow {
  order_id: string;
  order_number: string;
  order_state: string;
  payment_id: string;
  gateway_order_id: string;
  amount_paise: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const config = razorpayConfig();
  if (config === null) {
    console.error('Razorpay is not configured; nothing to reconcile against.');
    process.exit(1);
  }
  console.log(`Gateway: ${config.keyId} (${config.isTest ? 'test' : 'LIVE'})`);
  console.log(apply ? 'Mode: applying changes\n' : 'Mode: report only, use --apply to act\n');

  const pool = new Pool({ connectionString });

  try {
    const { rows } = await pool.query<PendingRow>(
      `select o.id as order_id, o.order_number, o.state as order_state,
              p.id as payment_id, p.gateway_order_id, p.amount_paise::text as amount_paise
         from payments p
         join orders o on o.id = p.order_id
        where p.gateway_order_id is not null
          and p.state in ('created', 'authorized')
          and o.state in ('created', 'payment_pending')
        order by o.created_at`,
    );

    if (rows.length === 0) {
      console.log('Nothing outstanding.');
      return;
    }

    let recovered = 0;
    let recoveredPaise = 0;

    for (const row of rows) {
      const expected = Number(row.amount_paise);
      let payments;
      try {
        payments = await fetchOrderPayments(config, row.gateway_order_id);
      } catch (error) {
        console.log(`${row.order_number}  could not reach the gateway: ${String(error)}`);
        continue;
      }

      const captured = payments.find((p) => p.status === 'captured');
      if (captured === undefined) {
        const states = payments.map((p) => p.status).join(', ') || 'no attempts';
        console.log(`${row.order_number}  ₹${expected / 100}  not paid (${states})`);
        continue;
      }

      // The same check the webhook makes. A capture for the wrong amount is
      // never treated as payment for this order.
      if (captured.amountPaise !== expected) {
        console.log(
          `${row.order_number}  MISMATCH: gateway says ₹${captured.amountPaise / 100}, order is ₹${expected / 100} — left alone`,
        );
        continue;
      }

      console.log(
        `${row.order_number}  ₹${expected / 100}  CAPTURED at gateway (${captured.id}, ${captured.method ?? 'unknown'})`,
      );

      if (!apply) continue;

      const client = await pool.connect();
      try {
        await client.query('begin');

        // Conditional on the payment still being unapplied, so a concurrent
        // page view doing the same work cannot double-apply.
        const updated = await client.query<{ id: string }>(
          `update payments
              set state = 'captured',
                  gateway_payment_id = coalesce(gateway_payment_id, $2),
                  method = coalesce(method, $3),
                  captured_at = coalesce(captured_at, now())
            where id = $1 and state <> 'captured'
            returning id`,
          [row.payment_id, captured.id, captured.method],
        );

        if (updated.rows.length > 0) {
          await client.query(
            `update orders set state = 'paid'
              where id = $1 and state in ('created', 'payment_pending')`,
            [row.order_id],
          );
          await client.query(
            `insert into audit_logs (actor_id, action, entity_type, entity_id, user_agent)
             values (null, 'payment.reconciled', 'order', $1::text, 'reconcile-cli')`,
            [row.order_id],
          );
          recovered += 1;
          recoveredPaise += expected;
          console.log('   -> marked paid');
        } else {
          console.log('   -> already applied');
        }

        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        console.error(`   -> failed, rolled back: ${String(error)}`);
      } finally {
        client.release();
      }
    }

    console.log(
      `\n${rows.length} checked. ${apply ? `${recovered} recovered, ₹${recoveredPaise / 100} total.` : 'Nothing changed — rerun with --apply.'}`,
    );
  } finally {
    await pool.end();
  }
}

await main();
