/**
 * Support tickets.
 *
 * A buyer or seller opens one, staff reply, either side can add to the trail
 * until it is closed. Distinct from a dispute: a dispute hangs off an order,
 * carries money and has an evidence deadline. A ticket is a question, and most
 * questions are not about an order at all.
 *
 * The trail is append-only at the database level. A support conversation is
 * the record of what was promised to a customer, and a promise that can be
 * quietly edited afterwards is not a record of anything.
 */

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.ts';
import { asObject, oneOf, optionalString, requiredString } from '../validate.ts';
import { one, type Database } from '../db.ts';

const TOPICS = [
  'order',
  'payment',
  'delivery',
  'listing',
  'account',
  'kyc',
  'payout',
  'other',
] as const;

const RAISED_AS = ['buyer', 'seller'] as const;

/** States staff may set. `awaiting_reply` and `answered` are set by replying. */
const STAFF_STATES = ['open', 'answered', 'resolved', 'closed'] as const;

const CLOSED: readonly string[] = ['resolved', 'closed'];

function ticketNumber(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, '0');
  return `RMT-${stamp}-${noise}`;
}

async function isStaff(ctx: Ctx, userId: string): Promise<boolean> {
  const roles = await ctx.db.query<{ role: string }>(
    `select role from user_roles where user_id = $1 and role = 'admin'`,
    [userId],
  );
  return roles.rows.length > 0;
}

interface TicketRow {
  id: string;
  ticket_number: string;
  raised_by: string;
  raised_as: string;
  topic: string;
  subject: string;
  state: string;
  order_id: string | null;
  order_number: string | null;
  created_at: string;
  updated_at: string;
  raiser: string;
  messages: string;
}

const shape = (r: TicketRow): Record<string, unknown> => ({
  id: r.id,
  ticketNumber: r.ticket_number,
  raisedAs: r.raised_as,
  topic: r.topic,
  subject: r.subject,
  state: r.state,
  orderId: r.order_id,
  orderNumber: r.order_number,
  raisedBy: r.raiser,
  messages: Number(r.messages),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SELECT = `
  select t.id, t.ticket_number, t.raised_by, t.raised_as, t.topic::text as topic,
         t.subject, t.state::text as state, t.order_id, o.order_number,
         t.created_at::text as created_at, t.updated_at::text as updated_at,
         coalesce(u.full_name, split_part(u.email, '@', 1)) as raiser,
         (select count(*) from ticket_messages m
           where m.ticket_id = t.id and m.is_internal = false)::text as messages
    from support_tickets t
    join users u on u.id = t.raised_by
    left join orders o on o.id = t.order_id`;

export function registerSupportRoutes(router: Router, _database: Database): void {
  /** POST /v1/support/tickets — raise one. */
  router.add('POST', '/v1/support/tickets', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;

    const fields = asObject(await ctx.body());
    const subject = requiredString(fields, 'subject', 200);
    const body = requiredString(fields, 'body', 5000);
    const topic = 'topic' in fields ? oneOf(fields, 'topic', TOPICS) : 'other';
    const raisedAs = 'raisedAs' in fields ? oneOf(fields, 'raisedAs', RAISED_AS) : 'buyer';
    const orderId = optionalString(fields, 'orderId', 36);

    if (subject.trim().length < 3) {
      throw badRequest('Give the ticket a subject so it can be found again.', {
        subject: 'too_short',
      });
    }
    if (body.trim().length < 10) {
      throw badRequest('Tell us a little more, so somebody can actually help.', {
        body: 'too_short',
      });
    }

    // An order may only be attached by somebody who is on it. Otherwise a
    // ticket becomes a way to ask questions about a stranger's purchase.
    if (orderId !== null) {
      const own = await ctx.db.query<{ id: string }>(
        `select o.id from orders o
          left join sellers s on s.id = o.seller_id
          where o.id = $1 and (o.buyer_id = $2 or s.user_id = $2)`,
        [orderId, userId],
      );
      if (own.rows.length === 0) throw notFound('No such order.');
    }

    const created = await ctx.db.query<{ id: string; ticket_number: string }>(
      `insert into support_tickets
         (ticket_number, raised_by, raised_as, topic, subject, order_id)
       values ($1, $2, $3, $4::ticket_topic, $5, $6)
       returning id, ticket_number`,
      [ticketNumber(), userId, raisedAs, topic, subject.trim(), orderId],
    );
    const ticketId = created.rows[0]!.id;

    await ctx.db.query(
      `insert into ticket_messages (ticket_id, author_id, from_staff, body)
       values ($1, $2, false, $3)`,
      [ticketId, userId, body.trim()],
    );

    return json(
      {
        ticket: { id: ticketId, ticketNumber: created.rows[0]!.ticket_number, state: 'open' },
      },
      201,
    );
  });

  /** GET /v1/support/tickets — the ones this person raised. */
  router.add('GET', '/v1/support/tickets', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const rows = await ctx.db.query<TicketRow>(
      `${SELECT} where t.raised_by = $1 order by t.updated_at desc limit 100`,
      [ctx.session.userId],
    );
    return json({ tickets: rows.rows.map(shape) });
  });

  /** GET /v1/admin/tickets — every ticket, newest activity first. */
  router.add('GET', '/v1/admin/tickets', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    if (!(await isStaff(ctx, ctx.session.userId))) throw notFound('Not found.');

    const state = ctx.url.searchParams.get('state');
    const rows = await ctx.db.query<TicketRow>(
      `${SELECT}
        where ($1::text is null or t.state = $1::ticket_state)
        order by t.updated_at desc limit 200`,
      [state],
    );
    return json({ tickets: rows.rows.map(shape) });
  });

  /** GET /v1/support/tickets/:id — one ticket and its trail. */
  router.add('GET', '/v1/support/tickets/:id', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;
    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such ticket.');

    const found = one(await ctx.db.query<TicketRow>(`${SELECT} where t.id = $1`, [id]));
    if (found === null) throw notFound('No such ticket.');

    const staff = await isStaff(ctx, userId);
    if (!staff && found.raised_by !== userId) throw notFound('No such ticket.');

    const messages = await ctx.db.query<{
      id: string;
      author: string;
      from_staff: boolean;
      is_internal: boolean;
      body: string;
      created_at: string;
    }>(
      `select m.id, m.from_staff, m.is_internal, m.body, m.created_at::text as created_at,
              coalesce(u.full_name, split_part(u.email, '@', 1)) as author
         from ticket_messages m
         join users u on u.id = m.author_id
        where m.ticket_id = $1
          -- Internal notes never reach the person who asked.
          and ($2::boolean or m.is_internal = false)
        order by m.created_at asc`,
      [id, staff],
    );

    return json({
      ticket: shape(found),
      messages: messages.rows.map((m) => ({
        id: m.id,
        author: m.from_staff ? 'Rare Minting' : m.author,
        fromStaff: m.from_staff,
        isInternal: m.is_internal,
        body: m.body,
        createdAt: m.created_at,
      })),
    });
  });

  /** POST /v1/support/tickets/:id/messages — add to the trail. */
  router.add('POST', '/v1/support/tickets/:id/messages', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;
    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such ticket.');

    const found = one(
      await ctx.db.query<{ id: string; raised_by: string; state: string }>(
        `select id, raised_by, state::text as state from support_tickets where id = $1`,
        [id],
      ),
    );
    if (found === null) throw notFound('No such ticket.');

    const staff = await isStaff(ctx, userId);
    if (!staff && found.raised_by !== userId) throw notFound('No such ticket.');

    if (CLOSED.includes(found.state) && !staff) {
      throw conflict('This ticket is closed. Raise a new one and we will pick it up there.');
    }

    const fields = asObject(await ctx.body());
    const body = requiredString(fields, 'body', 5000);
    if (body.trim().length === 0) throw badRequest('Write something first.', { body: 'empty' });

    const internal = staff && fields['internal'] === true;

    await ctx.db.query(
      `insert into ticket_messages (ticket_id, author_id, from_staff, body, is_internal)
       values ($1, $2, $3, $4, $5)`,
      [id, userId, staff, body.trim(), internal],
    );

    // An internal note is not an answer, so it must not move the ticket on or
    // stop the clock — otherwise a first-response time measures staff talking
    // to each other.
    if (!internal) {
      await ctx.db.query(
        `update support_tickets
            set state = case when $2 then 'answered'::ticket_state
                             else 'awaiting_reply'::ticket_state end,
                first_replied_at = case when $2 then coalesce(first_replied_at, now())
                                        else first_replied_at end,
                updated_at = now()
          where id = $1 and state not in ('closed')`,
        [id, staff],
      );
    }

    return json({ added: true }, 201);
  });

  /** POST /v1/admin/tickets/:id/state — staff move it on, or close it. */
  router.add('POST', '/v1/admin/tickets/:id/state', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;
    if (!(await isStaff(ctx, userId))) throw notFound('Not found.');

    const id = ctx.params['id'] ?? '';
    const fields = asObject(await ctx.body());
    const state = oneOf(fields, 'state', STAFF_STATES);

    const updated = await ctx.db.query<{ id: string; state: string }>(
      `update support_tickets
          set state = $2::ticket_state,
              closed_at = case when $2 in ('resolved','closed') then coalesce(closed_at, now())
                               else null end,
              assigned_to = coalesce(assigned_to, $3::uuid)
        where id = $1
        returning id, state::text as state`,
      [id, state, userId],
    );
    if (updated.rows.length === 0) throw notFound('No such ticket.');

    await ctx.db.query(
      `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, after, ip, user_agent)
       values ($1::uuid, 'admin', 'ticket.state', 'support_ticket', $2, $3::jsonb, $4::inet, $5)`,
      [userId, id, JSON.stringify({ state }), ctx.ip, ctx.userAgent],
    );

    return json({ id, state: updated.rows[0]!.state });
  });
}
