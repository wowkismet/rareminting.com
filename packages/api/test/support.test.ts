import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createRig, request, reset } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Support tickets.
 *
 * The tests that matter are the boundaries: one person's ticket must not be
 * readable by another, staff notes must never reach the person who asked, and
 * the trail must not be editable after the fact — a support conversation is
 * the record of what was promised to a customer.
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

async function person(): Promise<{ token: string; id: string }> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `tkt${n}@example.com`, password: 'correct horse battery' },
  });
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, id: body.user.id };
}

async function staff(): Promise<string> {
  const p = await person();
  await pg.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [p.id]);
  return p.token;
}

async function raise(token: string, subject = 'Where is my note?'): Promise<string> {
  const res = await request(app, 'POST', '/v1/support/tickets', {
    token,
    body: { subject, body: 'It was due on Tuesday and has not arrived.', topic: 'delivery' },
  });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { ticket: { id: string } }).ticket.id;
}

interface Thread {
  ticket: { state: string; subject: string; ticketNumber: string };
  messages: { body: string; fromStaff: boolean; isInternal: boolean; author: string }[];
}

async function read(token: string, id: string): Promise<Thread> {
  const res = await request(app, 'GET', `/v1/support/tickets/${id}`, { token });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as Thread;
}

describe('support tickets', () => {
  it('needs somebody signed in', async () => {
    const res = await request(app, 'POST', '/v1/support/tickets', {
      body: { subject: 'Hello', body: 'A question about my order.' },
    });
    assert.equal(res.status, 401);
  });

  it('opens with the first message already on the trail', async () => {
    const { token } = await person();
    const id = await raise(token);
    const thread = await read(token, id);

    assert.equal(thread.ticket.state, 'open');
    assert.match(thread.ticket.ticketNumber, /^RMT-/);
    assert.equal(thread.messages.length, 1);
    assert.equal(thread.messages[0]?.fromStaff, false);
  });

  it('asks for enough to act on', async () => {
    const { token } = await person();
    for (const body of [{ subject: 'Hi', body: 'A real question here.' }, { subject: 'A real subject', body: 'short' }]) {
      const res = await request(app, 'POST', '/v1/support/tickets', { token, body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  it('shows one person nothing of another person’s ticket', async () => {
    const mine = await person();
    const stranger = await person();
    const id = await raise(mine.token);

    const res = await request(app, 'GET', `/v1/support/tickets/${id}`, { token: stranger.token });
    assert.equal(res.status, 404, 'a 403 would confirm somebody else’s ticket exists');
  });

  it('lets staff read it, reply, and moves it to answered', async () => {
    const asker = await person();
    const admin = await staff();
    const id = await raise(asker.token);

    const replied = await request(app, 'POST', `/v1/support/tickets/${id}/messages`, {
      token: admin,
      body: { body: 'It shipped on Monday — here is the tracking number.' },
    });
    assert.equal(replied.status, 201, await replied.clone().text());

    const thread = await read(asker.token, id);
    assert.equal(thread.ticket.state, 'answered');
    assert.equal(thread.messages.length, 2);
    assert.equal(thread.messages[1]?.fromStaff, true);
    assert.equal(thread.messages[1]?.author, 'Rare Minting', 'staff answer as the company');
  });

  it('puts it back to awaiting a reply when the asker writes again', async () => {
    const asker = await person();
    const admin = await staff();
    const id = await raise(asker.token);

    await request(app, 'POST', `/v1/support/tickets/${id}/messages`, {
      token: admin,
      body: { body: 'Could you confirm the address?' },
    });
    await request(app, 'POST', `/v1/support/tickets/${id}/messages`, {
      token: asker.token,
      body: { body: 'Yes — flat 4, and the pin is 400001.' },
    });

    const thread = await read(asker.token, id);
    assert.equal(thread.ticket.state, 'awaiting_reply');
  });

  it('never shows an internal note to the person who asked', async () => {
    const asker = await person();
    const admin = await staff();
    const id = await raise(asker.token);

    await request(app, 'POST', `/v1/support/tickets/${id}/messages`, {
      token: admin,
      body: { body: 'Courier says the address is wrong. Do not refund yet.', internal: true },
    });

    const theirs = await read(asker.token, id);
    assert.equal(theirs.messages.length, 1, 'the asker sees only their own message');
    assert.ok(!JSON.stringify(theirs).includes('Do not refund'));

    const ours = await read(admin, id);
    assert.equal(ours.messages.length, 2, 'staff see the note');
    assert.equal(ours.messages[1]?.isInternal, true);
  });

  it('does not let a buyer mark their own note internal', async () => {
    const asker = await person();
    const admin = await staff();
    const id = await raise(asker.token);

    await request(app, 'POST', `/v1/support/tickets/${id}/messages`, {
      token: asker.token,
      body: { body: 'A note I am trying to hide.', internal: true },
    });

    const ours = await read(admin, id);
    assert.equal(ours.messages[1]?.isInternal, false, 'only staff can write an internal note');
  });

  it('closes, and then refuses a further reply from the asker', async () => {
    const asker = await person();
    const admin = await staff();
    const id = await raise(asker.token);

    const closed = await request(app, 'POST', `/v1/admin/tickets/${id}/state`, {
      token: admin,
      body: { state: 'closed' },
    });
    assert.equal(closed.status, 200, await closed.clone().text());

    const res = await request(app, 'POST', `/v1/support/tickets/${id}/messages`, {
      token: asker.token,
      body: { body: 'One more thing.' },
    });
    assert.equal(res.status, 409);
  });

  it('keeps the admin queue closed to everybody else', async () => {
    const { token } = await person();
    const res = await request(app, 'GET', '/v1/admin/tickets', { token });
    assert.equal(res.status, 404);
  });

  it('will not let the trail be rewritten afterwards', async () => {
    const { token } = await person();
    const id = await raise(token);

    await assert.rejects(
      pg.query(`update ticket_messages set body = 'something else' where ticket_id = $1`, [id]),
      'a promise that can be edited afterwards is not a record of anything',
    );
    await assert.rejects(
      pg.query(`delete from ticket_messages where ticket_id = $1`, [id]),
      'nor can it be deleted',
    );
  });
});
