import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createRig, request, reset, TEST_IP } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * The address book, and the promise that nothing is charged without one.
 *
 * Two things are worth testing here beyond the happy path. One is isolation:
 * an address belongs to exactly one person, and no id in a URL should reach
 * somebody else's. The other is that the invoice does not move — a bill that
 * silently rewrites itself when the buyer changes address later is not a bill.
 */

let pg: PGlite;
let app: App;

before(async () => {
  const rig = await createRig();
  pg = rig.pg;
  app = rig.app;
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await reset(pg);
});

let n = 0;

async function signUp(): Promise<string> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `addr${n}@example.com`, password: 'correct horse battery' },
  });
  return ((await res.json()) as { token: string }).token;
}

const GOOD = {
  recipientName: 'Anita Rao',
  line1: '14 Carter Road',
  line2: 'Bandra West',
  city: 'Mumbai',
  state: 'Maharashtra',
  postalCode: '400050',
  phone: '9876543210',
};

async function add(token: string, body: Record<string, unknown> = {}): Promise<Response> {
  return request(app, 'POST', '/v1/addresses', { token, body: { ...GOOD, ...body } });
}

describe('the address book', () => {
  it('needs a session', async () => {
    assert.equal((await request(app, 'GET', '/v1/addresses')).status, 401);
    assert.equal((await request(app, 'POST', '/v1/addresses', { body: GOOD })).status, 401);
  });

  it('stores one and normalises the phone number', async () => {
    const token = await signUp();
    const res = await add(token);
    assert.equal(res.status, 201, await res.clone().text());

    const { address } = (await res.json()) as {
      address: { phone: string; isDefault: boolean; city: string };
    };
    assert.equal(address.phone, '+919876543210');
    assert.equal(address.city, 'Mumbai');
    // Nothing to lose to, so the first one is the default whether asked or not.
    assert.equal(address.isDefault, true);
  });

  it('refuses a PIN code that is not an Indian one', async () => {
    const token = await signUp();
    for (const bad of ['012345', '4000', '40005X', '4000501']) {
      const res = await add(token, { postalCode: bad });
      assert.equal(res.status, 400, `expected ${bad} to be refused`);
    }
  });

  it('refuses a phone number that is not an Indian mobile', async () => {
    const token = await signUp();
    assert.equal((await add(token, { phone: '1234567890' })).status, 400);
    assert.equal((await add(token, { phone: '98765' })).status, 400);
    // With the country code in front is the same number, and is accepted.
    assert.equal((await add(token, { phone: '+91 98765 43210' })).status, 201);
  });

  it('keeps exactly one default when another is promoted', async () => {
    const token = await signUp();
    await add(token);
    const second = await add(token, { recipientName: 'Second', isDefault: true });
    assert.equal(second.status, 201, await second.clone().text());

    const list = (await (await request(app, 'GET', '/v1/addresses', { token })).json()) as {
      addresses: { recipientName: string; isDefault: boolean }[];
    };
    assert.equal(list.addresses.filter((a) => a.isDefault).length, 1);
    assert.equal(list.addresses.find((a) => a.isDefault)?.recipientName, 'Second');
    // The default sorts first, so the cart preselects the right one.
    assert.equal(list.addresses[0]?.recipientName, 'Second');
  });

  it('does not reach another person’s address', async () => {
    const mine = await signUp();
    const created = (await (await add(mine)).json()) as { address: { id: string } };

    const theirs = await signUp();
    assert.equal(
      (await request(app, 'PATCH', `/v1/addresses/${created.address.id}`, {
        token: theirs,
        body: { isDefault: true },
      })).status,
      404,
    );
    assert.equal(
      (await request(app, 'DELETE', `/v1/addresses/${created.address.id}`, { token: theirs }))
        .status,
      404,
    );

    // And it is still there, untouched.
    const list = (await (await request(app, 'GET', '/v1/addresses', { token: mine })).json()) as {
      addresses: unknown[];
    };
    assert.equal(list.addresses.length, 1);
  });

  it('sees only its own', async () => {
    const mine = await signUp();
    await add(mine);
    const theirs = await signUp();

    const list = (await (await request(app, 'GET', '/v1/addresses', { token: theirs })).json()) as {
      addresses: unknown[];
    };
    assert.equal(list.addresses.length, 0);
  });
});

describe('nothing is charged without somewhere to send it', () => {
  /** A published listing, and its seller. */
  async function published(serial: string): Promise<string> {
    const sellerRes = await request(app, 'POST', '/v1/auth/register', {
      body: { email: `addr-s${serial.replace(/\D/g, '')}@example.com`, password: 'correct horse battery' },
    });
    const seller = ((await sellerRes.json()) as { token: string }).token;

    const { sellerBody, approveSeller } = await import('./helpers.ts');
    const made = await request(app, 'POST', '/v1/sellers', {
      token: seller,
      body: sellerBody({ fullName: 'Ravi Menon' }),
    });
    const s = (await made.json()) as { seller: { id: string } };
    await approveSeller(pg, s.seller.id);

    const created = await request(app, 'POST', '/v1/listings', {
      token: seller,
      body: {
        serial,
        denomination: 100,
        series: 'Mahatma Gandhi New Series',
        priceInr: 4500,
      },
    });
    const { listing } = (await created.json()) as { listing: { id: string } };
    await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token: seller });
    return listing.id;
  }

  it('refuses a buy-now from somebody with no address', async () => {
    const listingId = await published('9AB 310001');
    const buyer = await signUp();

    const res = await request(app, 'POST', `/v1/listings/${listingId}/order`, { token: buyer });
    assert.equal(res.status, 400, await res.clone().text());
    const body = (await res.json()) as { details?: { addressId?: string } };
    assert.equal(body.details?.addressId, 'required');
  });

  it('refuses a cart checkout from somebody with no address', async () => {
    const listingId = await published('9AB 310002');
    const buyer = await signUp();
    await request(app, 'POST', '/v1/cart', { token: buyer, body: { listingId } });

    const res = await request(app, 'POST', '/v1/cart/checkout', { token: buyer });
    assert.equal(res.status, 400, await res.clone().text());
  });

  it('writes the address onto the order group, as text that will not move', async () => {
    const listingId = await published('9AB 310003');
    const buyer = await signUp();
    await add(buyer);
    await request(app, 'POST', '/v1/cart', { token: buyer, body: { listingId } });

    const res = await request(app, 'POST', '/v1/cart/checkout', { token: buyer });
    assert.equal(res.status, 201, await res.clone().text());
    const { group } = (await res.json()) as { group: { id: string } };

    const row = await pg.query<{ bill_to_name: string; bill_to_pin: string }>(
      `select bill_to_name, bill_to_pin from order_groups where id = $1`,
      [group.id],
    );
    assert.equal(row.rows[0]?.bill_to_name, 'Anita Rao');
    assert.equal(row.rows[0]?.bill_to_pin, '400050');

    // The invoice is a record of the day it was issued. Deleting the address
    // afterwards must not blank the bill, or every past order silently loses
    // the name it was made out to.
    const list = (await (await request(app, 'GET', '/v1/addresses', { token: buyer })).json()) as {
      addresses: { id: string }[];
    };
    await request(app, 'DELETE', `/v1/addresses/${list.addresses[0]!.id}`, { token: buyer });

    const after = await pg.query<{ bill_to_name: string; shipping_address_id: string | null }>(
      `select bill_to_name, shipping_address_id::text from order_groups where id = $1`,
      [group.id],
    );
    assert.equal(after.rows[0]?.bill_to_name, 'Anita Rao');
    assert.equal(after.rows[0]?.shipping_address_id, null);
  });
});
