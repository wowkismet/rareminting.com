import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';
import {
  decryptAccountNumber,
  encryptAccountNumber,
  parseAccountNumber,
  parseIfsc,
} from '../src/bank-details.ts';
import { DEFAULT_RATES } from '../src/money.ts';

/**
 * Paying sellers by bank transfer.
 *
 * The things that must not go wrong: a seller paid twice for one sale, a seller
 * paid before the buyer's protection has ended, and a bank account number
 * sitting in the database in the clear.
 */

let pg: PGlite;
let app: App;

before(async () => {
  process.env['BANK_DETAILS_KEY'] = 'test-bank-key-not-for-production-0123456789';
  const rig = await createRig();
  pg = rig.pg;
  app = rig.app;
});

after(async () => {
  delete process.env['BANK_DETAILS_KEY'];
  await pg.close();
});

beforeEach(async () => {
  await reset(pg);
  await pg.exec('truncate payouts, bank_accounts, payments cascade;');
});

let accounts = 0;
async function signUp(): Promise<string> {
  accounts += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `po${accounts}@example.com`, password: 'correct horse battery' },
  });
  return ((await res.json()) as { token: string }).token;
}

async function makeAdmin(): Promise<string> {
  const token = await signUp();
  const me = await request(app, 'GET', '/v1/auth/me', { token });
  const { user } = (await me.json()) as { user: { id: string } };
  await pg.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [user.id]);
  return token;
}

const BANK = {
  holderName: 'Kavya Kapoor',
  accountNumber: '123456789012',
  ifsc: 'HDFC0001234',
  bankName: 'HDFC Bank',
};

/** A seller with a paid order, ready to be settled. */
async function paidOrder(priceInr = 5000): Promise<{
  sellerToken: string;
  sellerId: string;
  orderId: string;
}> {
  const sellerToken = await signUp();
  const reg = await request(app, 'POST', '/v1/sellers', {
    token: sellerToken,
    body: sellerBody({ fullName: 'Kavya Kapoor' }),
  });
  const { seller } = (await reg.json()) as { seller: { id: string } };
  await approveSeller(pg, seller.id);

  accounts += 1;
  const created = await request(app, 'POST', '/v1/listings', {
    token: sellerToken,
    body: {
      serial: `9AB ${String(200000 + accounts).padStart(6, '0')}`,
      denomination: 100,
      series: 'Mahatma Gandhi New Series',
      priceInr,
    },
  });
  const { listing } = (await created.json()) as { listing: { id: string } };
  await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token: sellerToken });

  const buyer = await signUp();
  const ordered = await request(app, 'POST', `/v1/listings/${listing.id}/order`, { token: buyer });
  const { order } = (await ordered.json()) as { order: { id: string } };

  // Stand in for the gateway.
  await pg.query(`update orders set state = 'paid' where id = $1`, [order.id]);

  return { sellerToken, sellerId: seller.id, orderId: order.id };
}

async function addBank(token: string): Promise<Response> {
  return request(app, 'PUT', '/v1/sellers/me/bank-account', { token, body: BANK });
}

describe('commission', () => {
  it('is 20%', () => {
    assert.equal(DEFAULT_RATES.takeRateBps, 2000);
  });

  it('leaves the seller 20% short of the sale price, before GST and TDS', async () => {
    const { sellerToken, orderId } = await paidOrder(5000);
    const admin = await makeAdmin();
    await request(app, 'POST', `/v1/admin/orders/${orderId}/settle`, { token: admin });

    const res = await request(app, 'GET', '/v1/sellers/me/payouts', { token: sellerToken });
    const body = (await res.json()) as { totals: { availableInr: number } };

    // ₹5,000 less 20% commission, less 18% GST on that commission, less 1% TDS.
    assert.equal(body.totals.availableInr, 5000 - 1000 - 180 - 50);
  });
});

describe('bank details', () => {
  it('encrypts and decrypts, and the ciphertext does not contain the number', () => {
    const stored = encryptAccountNumber('123456789012');
    assert.equal(stored.includes('123456789012'), false);
    assert.equal(decryptAccountNumber(stored), '123456789012');
  });

  it('produces a different ciphertext each time, so equal accounts are not obvious', () => {
    assert.notEqual(encryptAccountNumber('123456789012'), encryptAccountNumber('123456789012'));
  });

  it('refuses to decrypt something that has been tampered with', () => {
    const stored = encryptAccountNumber('123456789012');
    const [iv, tag, data] = stored.split(':') as [string, string, string];
    const flipped = Buffer.from(data, 'base64');
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    assert.throws(() => decryptAccountNumber(`${iv}:${tag}:${flipped.toString('base64')}`));
  });

  it('validates account numbers and IFSC codes', () => {
    assert.equal(parseAccountNumber('1234 5678 9012'), '123456789012');
    assert.equal(parseAccountNumber('12345678'), null, 'too short');
    assert.equal(parseAccountNumber('1234567890123456789'), null, 'too long');
    assert.equal(parseAccountNumber('12345678abc'), null);

    assert.equal(parseIfsc('hdfc0001234'), 'HDFC0001234');
    assert.equal(parseIfsc('HDFC1001234'), null, 'the fifth character must be zero');
    assert.equal(parseIfsc('HDF0001234'), null);
  });

  it('stores no account number in the clear', async () => {
    const { sellerToken } = await paidOrder();
    const res = await addBank(sellerToken);
    assert.equal(res.status, 200);

    const rows = await pg.query<{ account_number_enc: string; account_last4: string }>(
      `select account_number_enc, account_last4 from bank_accounts`,
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]!.account_number_enc.includes(BANK.accountNumber), false);
    assert.equal(rows.rows[0]!.account_last4, '9012');
  });

  it('never returns the full number to the seller', async () => {
    const { sellerToken } = await paidOrder();
    await addBank(sellerToken);
    const res = await request(app, 'GET', '/v1/sellers/me/payouts', { token: sellerToken });
    const text = await res.text();
    assert.equal(text.includes(BANK.accountNumber), false, 'the full number came back');
    assert.ok(text.includes('9012'), 'the last four should be shown');
  });

  it('rejects a malformed account number or IFSC', async () => {
    const { sellerToken } = await paidOrder();
    for (const bad of [{ accountNumber: '123' }, { ifsc: 'NOTANIFSC' }]) {
      const res = await request(app, 'PUT', '/v1/sellers/me/bank-account', {
        token: sellerToken,
        body: { ...BANK, ...bad },
      });
      assert.equal(res.status, 400);
    }
  });

  it('replaces the account rather than accumulating them', async () => {
    const { sellerToken } = await paidOrder();
    await addBank(sellerToken);
    await request(app, 'PUT', '/v1/sellers/me/bank-account', {
      token: sellerToken,
      body: { ...BANK, accountNumber: '987654321098' },
    });

    const rows = await pg.query<{ account_last4: string }>(
      `select account_last4 from bank_accounts`,
    );
    assert.equal(rows.rows.length, 1, 'two payout destinations would be ambiguous');
    assert.equal(rows.rows[0]!.account_last4, '1098');
  });
});

describe('settling an order', () => {
  it('creates exactly one payout, and settling twice creates no more', async () => {
    const { orderId } = await paidOrder();
    const admin = await makeAdmin();

    const first = await request(app, 'POST', `/v1/admin/orders/${orderId}/settle`, { token: admin });
    assert.equal(first.status, 200);
    assert.equal(((await first.json()) as { payoutCreated: boolean }).payoutCreated, true);

    const second = await request(app, 'POST', `/v1/admin/orders/${orderId}/settle`, { token: admin });
    assert.equal(second.status, 409, 'a settled order was settled again');

    const count = await pg.query<{ n: string }>(`select count(*)::text as n from payouts`);
    assert.equal(count.rows[0]!.n, '1', 'the seller would have been paid twice');
  });

  it('refuses to settle an order that has not been paid', async () => {
    const { sellerToken } = await paidOrder();
    void sellerToken;
    const unpaid = await paidOrder();
    await pg.query(`update orders set state = 'payment_pending' where id = $1`, [unpaid.orderId]);

    const admin = await makeAdmin();
    const res = await request(app, 'POST', `/v1/admin/orders/${unpaid.orderId}/settle`, {
      token: admin,
    });
    assert.equal(res.status, 409, 'an unpaid order was settled');
  });

  it('is refused to a non-admin, as a 404', async () => {
    const { sellerToken, orderId } = await paidOrder();
    const res = await request(app, 'POST', `/v1/admin/orders/${orderId}/settle`, {
      token: sellerToken,
    });
    assert.equal(res.status, 404);
  });
});

describe('requesting a payout', () => {
  it('needs a bank account first', async () => {
    const { sellerToken, orderId } = await paidOrder();
    const admin = await makeAdmin();
    await request(app, 'POST', `/v1/admin/orders/${orderId}/settle`, { token: admin });

    const payouts = await request(app, 'GET', '/v1/sellers/me/payouts', { token: sellerToken });
    const { payouts: list } = (await payouts.json()) as { payouts: { id: string }[] };

    const res = await request(app, 'POST', `/v1/payouts/${list[0]!.id}/request`, {
      token: sellerToken,
    });
    assert.equal(res.status, 400);
  });

  it('moves the payout to requested, and cannot be requested twice', async () => {
    const { sellerToken, orderId } = await paidOrder();
    const admin = await makeAdmin();
    await request(app, 'POST', `/v1/admin/orders/${orderId}/settle`, { token: admin });
    await addBank(sellerToken);

    const before = await request(app, 'GET', '/v1/sellers/me/payouts', { token: sellerToken });
    const { payouts: list, totals } = (await before.json()) as {
      payouts: { id: string }[];
      totals: { availableInr: number; requestedInr: number };
    };
    assert.ok(totals.availableInr > 0);
    assert.equal(totals.requestedInr, 0);

    const first = await request(app, 'POST', `/v1/payouts/${list[0]!.id}/request`, {
      token: sellerToken,
    });
    assert.equal(first.status, 200);

    const second = await request(app, 'POST', `/v1/payouts/${list[0]!.id}/request`, {
      token: sellerToken,
    });
    assert.equal(second.status, 409, 'the same payout was requested twice');

    const after = await request(app, 'GET', '/v1/sellers/me/payouts', { token: sellerToken });
    const t = (await after.json()) as { totals: { availableInr: number; requestedInr: number } };
    assert.equal(t.totals.availableInr, 0);
    assert.ok(t.totals.requestedInr > 0);
  });

  it('will not let one seller request another seller\'s payout', async () => {
    const mine = await paidOrder();
    const admin = await makeAdmin();
    await request(app, 'POST', `/v1/admin/orders/${mine.orderId}/settle`, { token: admin });

    const list = await request(app, 'GET', '/v1/sellers/me/payouts', { token: mine.sellerToken });
    const { payouts } = (await list.json()) as { payouts: { id: string }[] };

    const other = await paidOrder();
    await addBank(other.sellerToken);

    const res = await request(app, 'POST', `/v1/payouts/${payouts[0]!.id}/request`, {
      token: other.sellerToken,
    });
    assert.equal(res.status, 404);
  });
});

describe('the admin transfer queue', () => {
  it('masks the account number until it is explicitly revealed, and audits the reveal', async () => {
    const { sellerToken, orderId } = await paidOrder();
    const admin = await makeAdmin();
    await request(app, 'POST', `/v1/admin/orders/${orderId}/settle`, { token: admin });
    await addBank(sellerToken);

    const list = await request(app, 'GET', '/v1/sellers/me/payouts', { token: sellerToken });
    const { payouts } = (await list.json()) as { payouts: { id: string }[] };
    await request(app, 'POST', `/v1/payouts/${payouts[0]!.id}/request`, { token: sellerToken });

    const masked = await request(app, 'GET', '/v1/admin/payouts', { token: admin });
    const maskedText = await masked.text();
    assert.equal(maskedText.includes(BANK.accountNumber), false, 'shown without being asked for');

    const revealed = await request(app, 'GET', '/v1/admin/payouts?reveal=true', { token: admin });
    const revealedText = await revealed.text();
    assert.ok(revealedText.includes(BANK.accountNumber), 'an admin could not see it to pay it');

    const audit = await pg.query<{ n: string }>(
      `select count(*)::text as n from audit_logs where action = 'payout.bank_details_viewed'`,
    );
    assert.equal(audit.rows[0]!.n, '1', 'looking at bank details was not recorded');
  });

  it('records a transfer against its reference, once', async () => {
    const { sellerToken, orderId } = await paidOrder();
    const admin = await makeAdmin();
    await request(app, 'POST', `/v1/admin/orders/${orderId}/settle`, { token: admin });
    await addBank(sellerToken);

    const list = await request(app, 'GET', '/v1/sellers/me/payouts', { token: sellerToken });
    const { payouts } = (await list.json()) as { payouts: { id: string }[] };
    const payoutId = payouts[0]!.id;
    await request(app, 'POST', `/v1/payouts/${payoutId}/request`, { token: sellerToken });

    const paid = await request(app, 'POST', `/v1/admin/payouts/${payoutId}/paid`, {
      token: admin,
      body: { reference: 'UTR1234567890' },
    });
    assert.equal(paid.status, 200);

    const again = await request(app, 'POST', `/v1/admin/payouts/${payoutId}/paid`, {
      token: admin,
      body: { reference: 'UTR9999999999' },
    });
    assert.equal(again.status, 409, 'a payout was marked paid twice');

    // The seller can see the reference and look it up with their bank.
    const after = await request(app, 'GET', '/v1/sellers/me/payouts', { token: sellerToken });
    const body = (await after.json()) as {
      totals: { paidInr: number; requestedInr: number };
      payouts: { reference: string | null }[];
    };
    assert.equal(body.payouts[0]!.reference, 'UTR1234567890');
    assert.ok(body.totals.paidInr > 0);
    assert.equal(body.totals.requestedInr, 0);
  });

  it('can hold a payout, which takes it out of the seller\'s available balance', async () => {
    const { sellerToken, orderId } = await paidOrder();
    const admin = await makeAdmin();
    await request(app, 'POST', `/v1/admin/orders/${orderId}/settle`, { token: admin });

    const list = await request(app, 'GET', '/v1/sellers/me/payouts', { token: sellerToken });
    const { payouts } = (await list.json()) as { payouts: { id: string }[] };

    const held = await request(app, 'POST', `/v1/admin/payouts/${payouts[0]!.id}/hold`, {
      token: admin,
      body: { reason: 'Awaiting proof of dispatch' },
    });
    assert.equal(held.status, 200);

    const after = await request(app, 'GET', '/v1/sellers/me/payouts', { token: sellerToken });
    const t = (await after.json()) as { totals: { availableInr: number; onHoldInr: number } };
    assert.equal(t.totals.availableInr, 0);
    assert.ok(t.totals.onHoldInr > 0);
  });
});
