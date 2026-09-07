import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { raiseTicket } from '@/app/actions.ts';
import { DashboardShell, Empty } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { buyerMenu } from '@/lib/buyer-dashboard.ts';
import { currentSeller, currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Help & support' };
export const dynamic = 'force-dynamic';

interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  topic: string;
  state: string;
  messages: number;
  orderNumber: string | null;
  updatedAt: string;
}

const STATE_LABEL: Record<string, string> = {
  open: 'Waiting for us',
  awaiting_reply: 'Waiting for us',
  answered: 'We have replied',
  resolved: 'Resolved',
  closed: 'Closed',
};

const TOPICS = [
  ['order', 'An order'],
  ['delivery', 'Delivery'],
  ['payment', 'A payment'],
  ['listing', 'A listing'],
  ['payout', 'A payout'],
  ['kyc', 'Verification'],
  ['account', 'My account'],
  ['other', 'Something else'],
] as const;

/**
 * Where somebody asks for help, and reads what we said back.
 *
 * A ticket is not a dispute. A dispute hangs off an order, carries money and
 * has a deadline; this is a question, and most questions are not about an
 * order at all. The page says so, and points at the dispute route for the
 * cases that genuinely are one.
 */
export default async function SupportPage() {
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const token = await sessionToken();
  const [seller, result] = await Promise.all([
    currentSeller(),
    api<{ tickets: Ticket[] }>('/v1/support/tickets', { token }),
  ]);
  const tickets = result.ok ? result.data.tickets : [];
  const open = tickets.filter((t) => !['resolved', 'closed'].includes(t.state));

  return (
    <DashboardShell
      user={user}
      eyebrow="The Vault"
      title="Help & support"
      subtitle={open.length === 0 ? 'Nothing outstanding' : `${open.length} open`}
      sections={buyerMenu({ orders: 0, isSeller: seller !== null })}
      current="/support"
    >
      <div className="flex flex-col gap-6">
        <Panel title="Ask us something">
          <form action={raiseTicket} className="flex flex-col gap-4">
            <input type="hidden" name="raisedAs" value={seller === null ? 'buyer' : 'seller'} />

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                What is it about
              </span>
              <select
                name="topic"
                defaultValue="order"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              >
                {TOPICS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                Subject
              </span>
              <input
                name="subject"
                required
                minLength={3}
                maxLength={200}
                placeholder="A short line so you can find this again"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                What has happened
              </span>
              <textarea
                name="body"
                required
                minLength={10}
                maxLength={5000}
                rows={5}
                placeholder="Order number, what you expected, and what happened instead."
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm leading-relaxed text-slate"
              />
            </label>

            <div>
              <button
                type="submit"
                className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                Send it
              </button>
            </div>
          </form>
        </Panel>

        <Panel title="Your tickets">
          {tickets.length === 0 ? (
            <Empty action={{ href: '/refunds', label: 'Refunds and cancellations' }}>
              Nothing raised yet. Anything you send appears here with our replies underneath.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {tickets.map((t) => (
                <li key={t.id}>
                  <a
                    href={`/support/${t.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-3 rounded-sm border border-sand-line bg-sand-raised p-4 transition-colors hover:border-accent-deep"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-slate">{t.subject}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-slate-dim">
                        {t.ticketNumber}
                        {t.orderNumber !== null && ` · ${t.orderNumber}`} · {t.messages} message
                        {t.messages === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${
                        t.state === 'answered'
                          ? 'text-accent-deep'
                          : ['resolved', 'closed'].includes(t.state)
                            ? 'text-slate-dim'
                            : 'text-ember'
                      }`}
                    >
                      {STATE_LABEL[t.state] ?? t.state}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          If a note arrived wrong, damaged, or never arrived at all, raise it against the order
          instead — that starts a claim with a deadline attached and can end in a refund, which a
          support ticket cannot. See{' '}
          <a href="/refunds" className="text-accent-deep underline underline-offset-4">
            refunds and cancellations
          </a>
          .
        </p>
      </div>
    </DashboardShell>
  );
}
