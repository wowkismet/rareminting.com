import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { addAddress, approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Invoices.
 *
 * Two things are worth testing hardest. Who may read one — an invoice carries
 * the buyer's full name, address and telephone number, so handing it to the
 * wrong person is a data breach, not a bug. And what each party is shown: the
 * platform's commission is between it and the seller, and a buyer must never
 * see what the marketplace takes from the other side.
 *
 * The second is enforced on the server rather than in the page, so it is
 * tested on the server: a page that filtered by role in the browser would be
 * one view-source away from leaking it.
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

async function signUp(): Promise<{ token: string; id: string }> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `inv${n}@example.com`, password: 'correct horse battery' },
  });
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, id: body.user.id };
}

/** A paid order with a real billing address behind it. */
async function paidOrder(): Promise<{ orderId: string; buyer: string; seller: string }> {
  const seller = await signUp();
  const reg = await request(app, 'POST', '/v1/sellers', {
    token: seller.token,
    body: sellerBody(),
  });
  const { seller: s } = (await reg.json()) as { seller: { id: string } };
  await approveSeller(pg, s.id);

  n += 1;
  const made = await request(app, 'POST', '/v1/listings', {
    token: seller.token,
    body: {
      serial: `9AB${String(800000 + n).padStart(6, '0')}`,
      denomination: 100,
      series: 'Mahatma Gandhi New Series',
      priceInr: 4500,
    },
  });
  const { listing } = (await made.json()) as { listing: { id: string } };
  await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token: seller.token });

  const buyer = await signUp();
  await addAddress(app, buyer.token);
  await request(app, 'POST', '/v1/cart', { token: buyer.token, body: { listingId: listing.id } });
  const checkout = await request(app, 'POST', '/v1/cart/checkout', {
    token: buyer.token,
    body: {},
  });
  assert.equal(checkout.status, 201, await checkout.clone().text());
  const { orders } = (await checkout.json()) as { orders: { id: string }[] };
  const orderId = orders[0]!.id;

  await pg.query(`update orders set state = 'paid' where id = $1`, [orderId]);
  await pg.query(`update order_items set state = 'paid' where order_id = $1`, [orderId]);

  return { orderId, buyer: buyer.token, seller: seller.token };
}

async function makeAdmin(token: string): Promise<void> {
  const me = await request(app, 'GET', '/v1/auth/me', { token });
  const { user } = (await me.json()) as { user: { id: string } };
  await pg.query(
    `insert into user_roles (user_id, role) values ($1, 'admin')
     on conflict do nothing`,
    [user.id],
  );
}

interface InvoiceBody {
  invoice: {
    role: string;
    canPrint: boolean;
    kind: string;
    orderNumber: string;
    billTo: { name: string; postalCode: string } | null;
    items: { title: string; priceInr: number }[];
    charges: { subtotalInr: number; totalInr: number };
    settlement?: { commissionInr: number; payoutInr: number };
    delivery: { awb: string | null; barcode: string; barcodeIs: string };
  };
}

async function invoice(token: string, orderId: string): Promise<Response> {
  return request(app, 'GET', `/v1/orders/${orderId}/invoice`, { token });
}

describe('who may read an invoice', () => {
  it('gives it to the buyer', async () => {
    const { orderId, buyer } = await paidOrder();
    const res = await invoice(buyer, orderId);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as InvoiceBody).invoice.role, 'buyer');
  });

  it('gives it to the seller', async () => {
    const { orderId, seller } = await paidOrder();
    const res = await invoice(seller, orderId);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as InvoiceBody).invoice.role, 'seller');
  });

  it('gives it to staff', async () => {
    const { orderId } = await paidOrder();
    const admin = await signUp();
    await makeAdmin(admin.token);

    const res = await invoice(admin.token, orderId);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as InvoiceBody).invoice.role, 'admin');
  });

  it('refuses a stranger, as a 404', async () => {
    // It carries the buyer's name, address and phone number. Whose order this
    // is, is not something a stranger needs confirmed either.
    const { orderId } = await paidOrder();
    const stranger = await signUp();
    assert.equal((await invoice(stranger.token, orderId)).status, 404);
  });

  it('refuses anonymous callers', async () => {
    const { orderId } = await paidOrder();
    const res = await request(app, 'GET', `/v1/orders/${orderId}/invoice`);
    assert.equal(res.status, 401);
  });
});

describe('what each party is shown', () => {
  it('never shows the buyer what the platform takes', async () => {
    const { orderId, buyer } = await paidOrder();
    const body = (await (await invoice(buyer, orderId)).json()) as InvoiceBody;

    assert.equal(body.invoice.settlement, undefined, 'commission is not the buyer’s business');
    // And it is genuinely absent rather than zeroed — a zero would still be a
    // statement about the seller's economics.
    assert.equal(
      JSON.stringify(body).includes('commission'),
      false,
      'no trace of commission anywhere in the payload',
    );
  });

  it('shows the seller their own settlement', async () => {
    const { orderId, seller } = await paidOrder();
    const body = (await (await invoice(seller, orderId)).json()) as InvoiceBody;

    assert.notEqual(body.invoice.settlement, undefined);
    assert.ok(body.invoice.settlement!.payoutInr > 0);
    assert.ok(body.invoice.settlement!.payoutInr < body.invoice.charges.subtotalInr);
  });

  it('shows staff the settlement too, so they can answer about it', async () => {
    const { orderId } = await paidOrder();
    const admin = await signUp();
    await makeAdmin(admin.token);

    const body = (await (await invoice(admin.token, orderId)).json()) as InvoiceBody;
    assert.notEqual(body.invoice.settlement, undefined);
  });

  it('offers printing to the seller and staff, not the buyer', async () => {
    const { orderId, buyer, seller } = await paidOrder();
    const admin = await signUp();
    await makeAdmin(admin.token);

    assert.equal(((await (await invoice(buyer, orderId)).json()) as InvoiceBody).invoice.canPrint, false);
    assert.equal(((await (await invoice(seller, orderId)).json()) as InvoiceBody).invoice.canPrint, true);
    assert.equal(
      ((await (await invoice(admin.token, orderId)).json()) as InvoiceBody).invoice.canPrint,
      true,
    );
  });
});

describe('the document itself', () => {
  it('carries the address as it was written at checkout', async () => {
    const { orderId, buyer } = await paidOrder();
    const body = (await (await invoice(buyer, orderId)).json()) as InvoiceBody;

    assert.notEqual(body.invoice.billTo, null);
    assert.equal(body.invoice.billTo!.name, 'Test Buyer');
    assert.equal(body.invoice.billTo!.postalCode, '400020');
  });

  it('is a proforma until the order has been paid for', async () => {
    // Calling an unpaid document a tax invoice is how a company ends up
    // accounting for revenue it never received.
    const { orderId, buyer } = await paidOrder();
    await pg.query(`update orders set state = 'payment_pending' where id = $1`, [orderId]);

    const body = (await (await invoice(buyer, orderId)).json()) as InvoiceBody;
    assert.equal(body.invoice.kind, 'proforma');
  });

  it('becomes a tax invoice once it is paid', async () => {
    const { orderId, buyer } = await paidOrder();
    const body = (await (await invoice(buyer, orderId)).json()) as InvoiceBody;
    assert.equal(body.invoice.kind, 'invoice');
  });

  it('lists what was actually bought', async () => {
    const { orderId, buyer } = await paidOrder();
    const body = (await (await invoice(buyer, orderId)).json()) as InvoiceBody;
    assert.equal(body.invoice.items.length, 1);
    assert.equal(body.invoice.items[0]!.priceInr, 4500);
    assert.equal(body.invoice.charges.subtotalInr, 4500);
  });

  it('leaves a cancelled line off', async () => {
    const { orderId, buyer } = await paidOrder();
    await pg.query(`update order_items set state = 'cancelled' where order_id = $1`, [orderId]);

    const body = (await (await invoice(buyer, orderId)).json()) as InvoiceBody;
    assert.equal(body.invoice.items.length, 0);
  });
});

describe('the delivery barcode', () => {
  it('barcodes the order number until a courier has been booked', async () => {
    const { orderId, seller } = await paidOrder();
    const body = (await (await invoice(seller, orderId)).json()) as InvoiceBody;

    assert.equal(body.invoice.delivery.awb, null);
    assert.equal(body.invoice.delivery.barcodeIs, 'order');
    assert.equal(body.invoice.delivery.barcode, body.invoice.orderNumber);
  });

  it('barcodes the AWB once there is one', async () => {
    const { orderId, seller } = await paidOrder();
    await pg.query(
      `update orders set awb = 'AWB4455667788', courier_name = 'Delhivery' where id = $1`,
      [orderId],
    );

    const body = (await (await invoice(seller, orderId)).json()) as InvoiceBody;
    assert.equal(body.invoice.delivery.barcodeIs, 'awb');
    assert.equal(body.invoice.delivery.barcode, 'AWB4455667788');
  });

  it('always has something to barcode', async () => {
    // A label with no barcode is a label somebody has to write on by hand.
    const { orderId, buyer } = await paidOrder();
    const body = (await (await invoice(buyer, orderId)).json()) as InvoiceBody;
    assert.ok(body.invoice.delivery.barcode.length > 0);
  });
});
