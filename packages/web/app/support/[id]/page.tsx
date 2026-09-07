import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { replyToTicket, setTicketState } from '@/app/actions.ts';
import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { buyerMenu } from '@/lib/buyer-dashboard.ts';
import { currentSeller, currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Ticket', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface Thread {
  ticket: {
    id: string;
    ticketNumber: string;
    subject: string;
    state: string;
    orderId: string | null;
    orderNumber: string | null;
    createdAt: string;
  };
  messages: {
    id: string;
    author: string;
    fromStaff: boolean;
    isInternal: boolean;
    body: string;
    createdAt: string;
  }[];
}

const CLOSED = ['resolved', 'closed'];

/** One ticket, and everything said on it. */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const token = await sessionToken();
  const [seller, result] = await Promise.all([
    currentSeller(),
    api<Thread>(`/v1/support/tickets/${id}`, { token }),
  ]);
  if (!result.ok) notFound();

  const { ticket, messages } = result.data;
  const closed = CLOSED.includes(ticket.state);
  const isStaff = user.roles.includes('admin');

  return (
    <DashboardShell
      user={user}
      eyebrow={ticket.ticketNumber}
      title={ticket.subject}
      subtitle={closed ? 'This ticket is closed' : undefined}
      sections={buyerMenu({ orders: 0, isSeller: seller !== null })}
      current="/support"
    >
      <div className="flex max-w-3xl flex-col gap-6">
        {ticket.orderNumber !== null && ticket.orderId !== null && (
          <p className="text-sm text-slate-dim">
            About order{' '}
            <a
              href={`/orders/${ticket.orderId}`}
              className="font-mono text-accent-deep underline underline-offset-4"
            >
              {ticket.orderNumber}
            </a>
          </p>
        )}

        <Panel title="The conversation">
          <ol className="flex flex-col gap-5">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`border-l-2 pl-4 ${
                  m.isInternal
                    ? 'border-ember/50'
                    : m.fromStaff
                      ? 'border-accent-deep'
                      : 'border-sand-line'
                }`}
              >
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span
                    className={`text-sm ${m.fromStaff ? 'text-accent-deep' : 'text-slate'}`}
                  >
                    {m.author}
                  </span>
                  <span className="font-mono text-[10px] text-slate-dim">
                    {m.createdAt.slice(0, 16).replace('T', ' ')}
                  </span>
                  {m.isInternal && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ember">
                      Internal — not shown to them
                    </span>
                  )}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate">
                  {m.body}
                </p>
              </li>
            ))}
          </ol>
        </Panel>

        {closed ? (
          <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
            This ticket is closed, so the trail above stays as it is. If there is more to say,{' '}
            <a href="/support" className="text-accent-deep underline underline-offset-4">
              raise a new one
            </a>{' '}
            and quote {ticket.ticketNumber}.
          </p>
        ) : (
          <Panel title="Reply">
            <form action={replyToTicket} className="flex flex-col gap-3">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <label htmlFor="body" className="sr-only">
                Your reply
              </label>
              <textarea
                id="body"
                name="body"
                required
                minLength={1}
                maxLength={5000}
                rows={4}
                placeholder="Add to the conversation…"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm leading-relaxed text-slate"
              />
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="submit"
                  className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
                >
                  Send reply
                </button>
                {isStaff && (
                  <label className="flex items-center gap-2 text-sm text-slate-dim">
                    <input type="checkbox" name="internal" value="yes" />
                    Internal note — not shown to them
                  </label>
                )}
              </div>
            </form>
          </Panel>
        )}

        {isStaff && (
          <Panel title="Staff">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['answered', 'Mark replied'],
                  ['resolved', 'Resolve'],
                  ['closed', 'Close'],
                  ['open', 'Reopen'],
                ] as const
              ).map(([state, label]) => (
                <form action={setTicketState} key={state}>
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <input type="hidden" name="state" value={state} />
                  <button
                    type="submit"
                    className="rounded-full border border-sand-line px-4 py-1.5 text-xs text-slate transition-colors hover:border-accent-deep hover:text-accent-deep"
                  >
                    {label}
                  </button>
                </form>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-dim">
              Closing keeps the trail exactly as it is and stops the person who asked from adding
              to it. Every change of state is recorded against your account.
            </p>
          </Panel>
        )}
      </div>
    </DashboardShell>
  );
}
