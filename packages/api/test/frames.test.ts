import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';

import {
  addAddress,
  approveSeller,
  createRig,
  request,
  reset,
  sellerBody,
  TEST_IP,
} from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Frames, and the gift personalisation that goes in them.
 *
 * Two things here are worth testing harder than the rest. One is that a
 * buyer's photograph cannot be read by anybody else: it is a family
 * photograph, not a listing photograph, and the whole reason it is stored
 * outside `uploads/` is that nginx would otherwise hand it to anyone with the
 * URL. The other is that the price is snapshotted at checkout — a frame
 * repriced next month must not change what an invoice already says.
 */

let pg: PGlite;
let app: App;
let giftDir: string;

before(async () => {
  const rig = await createRig();
  pg = rig.pg;
  app = rig.app;

  // Photographs land on disk. Point them somewhere disposable; the route
  // reads this on each call rather than at import, which is what makes
  // setting it here work at all.
  giftDir = await mkdtemp(path.join(tmpdir(), 'rm-gifts-'));
  process.env['GIFT_DIR'] = giftDir;
});

after(async () => {
  await pg.close();
  delete process.env['GIFT_DIR'];
  await rm(giftDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await reset(pg);
});

let n = 0;

async function buyer(): Promise<string> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `fr-buy${n}@example.com`, password: 'correct horse battery' },
  });
  const token = ((await res.json()) as { token: string }).token;
  await addAddress(app, token);
  return token;
}

/** An approved seller with one published note, at `price` rupees. */
async function listing(price = 4500): Promise<string> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `fr-sell${n}@example.com`, password: 'correct horse battery' },
  });
  const token = ((await res.json()) as { token: string }).token;
  const reg = await request(app, 'POST', '/v1/sellers', { token, body: sellerBody() });
  const { seller } = (await reg.json()) as { seller: { id: string } };
  await approveSeller(pg, seller.id);

  n += 1;
  const made = await request(app, 'POST', '/v1/listings', {
    token,
    body: {
      serial: `9AB${String(400000 + n).padStart(6, '0')}`,
      denomination: 100,
      series: 'Mahatma Gandhi New Series',
      priceInr: price,
    },
  });
  const { listing: l } = (await made.json()) as { listing: { id: string } };
  await request(app, 'POST', `/v1/listings/${l.id}/publish`, { token });
  return l.id;
}

async function inCart(token: string, price = 4500): Promise<string> {
  const id = await listing(price);
  const res = await request(app, 'POST', '/v1/cart', { token, body: { listingId: id } });
  assert.equal(res.status < 300, true, await res.clone().text());
  return id;
}

/** The smallest thing that passes the PNG signature check. */
function png(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

/** The photo route takes multipart, which the JSON helper cannot send. */
async function upload(
  token: string,
  listingId: string,
  bytes: Uint8Array,
  filename = 'amma.png',
): Promise<Response> {
  const form = new FormData();
  form.set('file', new File([bytes], filename));
  return app.handle(
    new Request(`http://api.test/v1/cart/${listingId}/frame/photo`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
    TEST_IP,
  );
}

describe('the frames on offer', () => {
  it('lists the active frames without signing in', async () => {
    const res = await request(app, 'GET', '/v1/frames');
    assert.equal(res.status, 200);

    const { frames } = (await res.json()) as {
      frames: { code: string; name: string; orientation: string; priceInr: number }[];
    };
    assert.equal(frames.length, 8);
    assert.equal(frames[0]?.code, 'royal-navy');

    const gallery = frames.find((f) => f.code === 'royal-gallery');
    assert.equal(gallery?.priceInr, 1999);
    assert.equal(gallery?.orientation, 'portrait');
  });

  it('leaves a withdrawn frame out', async () => {
    await pg.query(`update frame_templates set is_active = false where code = 'signature'`);
    try {
      const res = await request(app, 'GET', '/v1/frames');
      const { frames } = (await res.json()) as { frames: { code: string }[] };
      assert.equal(frames.length, 7);
      assert.equal(
        frames.some((f) => f.code === 'signature'),
        false,
      );
    } finally {
      await pg.query(`update frame_templates set is_active = true where code = 'signature'`);
    }
  });
});

describe('choosing a frame for one note', () => {
  it('saves the frame and the card, and reads them back on the cart line', async () => {
    const token = await buyer();
    const id = await inCart(token);

    const put = await request(app, 'PUT', `/v1/cart/${id}/frame`, {
      token,
      body: {
        frameCode: 'heritage-blue',
        recipient: 'Amma',
        sender: 'Ravi',
        message: 'The day you were born.',
        occasionOn: '1964-08-12',
      },
    });
    assert.equal(put.status, 200, await put.clone().text());

    const cart = await request(app, 'GET', '/v1/cart', { token });
    const { items } = (await cart.json()) as {
      items: { listingId: string; frame: Record<string, unknown> }[];
    };
    const line = items.find((i) => i.listingId === id);
    assert.equal(line?.frame['code'], 'heritage-blue');
    assert.equal(line?.frame['recipient'], 'Amma');
    assert.equal(line?.frame['sender'], 'Ravi');
    assert.equal(line?.frame['message'], 'The day you were born.');
    assert.equal(line?.frame['occasionOn'], '1964-08-12');
  });

  it('frames each note separately', async () => {
    const token = await buyer();
    const first = await inCart(token);
    const second = await inCart(token);

    await request(app, 'PUT', `/v1/cart/${first}/frame`, {
      token,
      body: { frameCode: 'royal-navy' },
    });
    await request(app, 'PUT', `/v1/cart/${second}/frame`, {
      token,
      body: { frameCode: 'executive' },
    });

    const cart = await request(app, 'GET', '/v1/cart', { token });
    const { items } = (await cart.json()) as {
      items: { listingId: string; frame: { code: string | null } }[];
    };
    assert.equal(items.find((i) => i.listingId === first)?.frame.code, 'royal-navy');
    assert.equal(items.find((i) => i.listingId === second)?.frame.code, 'executive');
  });

  it('refuses a listing that is not in this cart', async () => {
    const token = await buyer();
    const other = await buyer();
    const id = await inCart(other);

    const res = await request(app, 'PUT', `/v1/cart/${id}/frame`, {
      token,
      body: { frameCode: 'royal-navy' },
    });
    assert.equal(res.status, 404);
  });

  it('refuses a frame that does not exist, and one that was withdrawn', async () => {
    const token = await buyer();
    const id = await inCart(token);

    const madeUp = await request(app, 'PUT', `/v1/cart/${id}/frame`, {
      token,
      body: { frameCode: 'gilded-unicorn' },
    });
    assert.equal(madeUp.status, 400);

    await pg.query(`update frame_templates set is_active = false where code = 'executive'`);
    try {
      const gone = await request(app, 'PUT', `/v1/cart/${id}/frame`, {
        token,
        body: { frameCode: 'executive' },
      });
      assert.equal(gone.status, 400);
    } finally {
      await pg.query(`update frame_templates set is_active = true where code = 'executive'`);
    }
  });

  it('refuses something that is not a date', async () => {
    const token = await buyer();
    const id = await inCart(token);
    const res = await request(app, 'PUT', `/v1/cart/${id}/frame`, {
      token,
      body: { frameCode: 'royal-navy', occasionOn: '12/8/64' },
    });
    assert.equal(res.status, 400);
  });

  it('takes the frame off again', async () => {
    const token = await buyer();
    const id = await inCart(token);
    await request(app, 'PUT', `/v1/cart/${id}/frame`, {
      token,
      body: { frameCode: 'royal-navy', message: 'For you.' },
    });

    const cleared = await request(app, 'DELETE', `/v1/cart/${id}/frame`, { token });
    assert.equal(cleared.status, 200);

    const cart = await request(app, 'GET', '/v1/cart', { token });
    const { items } = (await cart.json()) as {
      items: { listingId: string; frame: { code: string | null; message: string | null } }[];
    };
    const line = items.find((i) => i.listingId === id);
    assert.equal(line?.frame.code, null);
    assert.equal(line?.frame.message, null);
  });

  it('turns an anonymous caller away', async () => {
    const token = await buyer();
    const id = await inCart(token);
    const res = await request(app, 'PUT', `/v1/cart/${id}/frame`, {
      body: { frameCode: 'royal-navy' },
    });
    assert.equal(res.status, 401);
  });
});

describe('the photograph on the frame', () => {
  it('stores it, keys it to the buyer, and gives it back to them', async () => {
    const token = await buyer();
    const id = await inCart(token);

    const up = await upload(token, id, png());
    assert.equal(up.status, 201, await up.clone().text());
    const { photo } = (await up.json()) as { photo: { key: string; contentType: string } };
    assert.equal(photo.contentType, 'image/png');

    const cart = await request(app, 'GET', '/v1/cart', { token });
    const { items } = (await cart.json()) as {
      items: { listingId: string; frame: { photoUrl: string | null } }[];
    };
    const url = items.find((i) => i.listingId === id)?.frame.photoUrl;
    assert.equal(url, `/v1/gift-photo/${photo.key}`);

    const back = await request(app, 'GET', url ?? '', { token });
    assert.equal(back.status, 200);
    assert.equal(back.headers.get('content-type'), 'image/png');
    // Private to one person, so no shared cache may hold a copy.
    assert.match(back.headers.get('cache-control') ?? '', /private/);
  });

  it('will not hand one buyer another buyer’s photograph', async () => {
    const mine = await buyer();
    const id = await inCart(mine);
    const up = await upload(mine, id, png());
    const { photo } = (await up.json()) as { photo: { key: string } };

    // The nosy party has the exact URL — copied, logged, guessed, it does not
    // matter how. Ownership is checked, not assumed.
    const theirs = await buyer();
    const res = await request(app, 'GET', `/v1/gift-photo/${photo.key}`, { token: theirs });
    assert.equal(res.status, 403);

    const anonymous = await request(app, 'GET', `/v1/gift-photo/${photo.key}`);
    assert.equal(anonymous.status, 401);
  });

  it('refuses a name that is not one it generated', async () => {
    const token = await buyer();
    const me = (
      (await (await request(app, 'GET', '/v1/auth/me', { token })).json()) as { user: { id: string } }
    ).user.id;

    for (const name of ['../../etc/passwd', 'notes.jpg', `${'a'.repeat(36)}.exe`]) {
      const res = await request(app, 'GET', `/v1/gift-photo/${me}/${encodeURIComponent(name)}`, {
        token,
      });
      assert.equal(res.status === 404 || res.status === 400, true, `${name} gave ${res.status}`);
    }
  });

  it('refuses something that is not an image, whatever it is called', async () => {
    const token = await buyer();
    const id = await inCart(token);
    const script = new TextEncoder().encode('<?php system($_GET["c"]); ?>          ');
    const res = await upload(token, id, script, 'innocent.png');
    assert.equal(res.status, 400);
  });

  it('refuses an empty file', async () => {
    const token = await buyer();
    const id = await inCart(token);
    const res = await upload(token, id, new Uint8Array(0));
    assert.equal(res.status, 400);
  });

  it('refuses a listing that is not in this cart', async () => {
    const token = await buyer();
    const other = await buyer();
    const id = await inCart(other);
    const res = await upload(token, id, png());
    assert.equal(res.status, 404);
  });
});

describe('a frame at checkout', () => {
  it('is charged for, snapshotted, and survives the template being repriced', async () => {
    const token = await buyer();
    const id = await inCart(token, 4500);
    await request(app, 'PUT', `/v1/cart/${id}/frame`, {
      token,
      body: { frameCode: 'signature', recipient: 'Amma', message: 'For you.' },
    });

    const res = await request(app, 'POST', '/v1/cart/checkout', { token, body: {} });
    assert.equal(res.status, 201, await res.clone().text());
    const { group } = (await res.json()) as {
      group: { id: string; subtotalInr: number; frameInr: number; totalInr: number };
    };

    assert.equal(group.subtotalInr, 4500);
    assert.equal(group.frameInr, 2499);
    // The frame is on the bill, not folded into the note's price.
    assert.equal(group.totalInr >= 4500 + 2499, true);

    const item = await pg.query<{
      frame_code: string;
      frame_name: string;
      frame_price_paise: string;
      frame_recipient: string;
    }>(
      `select frame_code, frame_name, frame_price_paise::text as frame_price_paise,
              frame_recipient
         from order_items where listing_id = $1`,
      [id],
    );
    assert.equal(item.rows[0]?.frame_code, 'signature');
    assert.equal(item.rows[0]?.frame_name, 'Signature Edition');
    assert.equal(item.rows[0]?.frame_price_paise, '249900');
    assert.equal(item.rows[0]?.frame_recipient, 'Amma');

    // Reprice the template. The invoice must not move — that is the whole
    // reason the price is copied onto the line rather than joined to it.
    await pg.query(`update frame_templates set price_paise = 4999_00 where code = 'signature'`);
    try {
      const fetched = await request(app, 'GET', `/v1/order-groups/${group.id}`, { token });
      const back = (await fetched.json()) as { group: { frameInr: number } };
      assert.equal(back.group.frameInr, 2499);
    } finally {
      await pg.query(`update frame_templates set price_paise = 2499_00 where code = 'signature'`);
    }
  });

  it('charges nothing extra when no frame was chosen', async () => {
    const token = await buyer();
    await inCart(token, 4500);

    const res = await request(app, 'POST', '/v1/cart/checkout', { token, body: {} });
    const { group } = (await res.json()) as { group: { frameInr: number } };
    assert.equal(group.frameInr, 0);
  });
});
