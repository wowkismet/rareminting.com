import type { Metadata } from 'next';

import { DashboardShell, Empty } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Support tickets',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  topic: string;
  state: string;
  raisedAs: string;
  raisedBy: string;
  messages: number;
  orderNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATE_LABEL: Record<string, string> = {
  open: 'New',
  awaiting_reply: 'Needs a reply',
  answered: 'Replied',
  resolved: 'Resolved',
  closed: 'Closed',
};

const TONE: Record<string, string> = {
  open: 'text-ember',
  awaiting_reply: 'text-ember',
  answered: 'text-accent-deep',
  resolved: 'text-slate-dim',
  closed: 'text-slate-dim',
};

/** How long a ticket has been sitting, in the coarsest useful unit. */
function waiting(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * The support queue.
 *
 * Ordered by what has waited longest rather than by what arrived last: the
 * ticket somebody raised on Friday and has heard nothing about is the one that
 * costs a customer, and a newest-first list is exactly how it gets buried.
 */
export default async function AdminSupportPage() {
  const { user, token, sections } = await loadAdmin();
  const result = await api<{ tickets: Ticket[] }>('/v1/admin/tickets', { token });
  const tickets = result.ok ? result.data.tickets : [];

  const needsReply = tickets.filter((t) => ['open', 'awaiting_reply'].includes(t.state));
  const answered = tickets.filter((t) => t.state === 'answered').length;
  const closed = tickets.filter((t) => ['resolved', 'closed'].includes(t.state)).length;

  const queue = [...needsReply].sort(
    (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
  );
  const rest = tickets.filter((t) => !['open', 'awaiting_reply'].includes(t.state));

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Support tickets"
      subtitle={
        needsReply.length === 0 ? 'Nothing waiting' : `${needsReply.length} waiting for a reply`
      }
      sections={sections}
      current="/admin/support"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Waiting for a reply" value={String(needsReply.length)} accent />
          <StatCard
            label="Longest wait"
            value={queue.length === 0 ? '—' : waiting(queue[0]!.updatedAt)}
            hint={queue.length === 0 ? 'queue is empty' : 'since anyone answered'}
          />
          <StatCard label="Replied" value={String(answered)} />
          <StatCard label="Closed" value={String(closed)} />
        </div>

        <Panel title="Waiting — longest first">
          {queue.length === 0 ? (
            <Empty action={{ href: '/admin', label: 'Back to the console' }}>
              Nothing waiting. Tickets raised by buyers and sellers land here.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {queue.map((t) => (
                <li key={t.id}>
                  <a
                    href={`/support/${t.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-3 rounded-sm border border-sand-line bg-sand-raised p-4 transition-colors hover:border-accent-deep"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-slate">{t.subject}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-slate-dim">
                        {t.ticketNumber} · {t.raisedBy} ({t.raisedAs}) · {t.topic}
                        {t.orderNumber !== null && ` · ${t.orderNumber}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-3">
                      <span className="font-mono text-[10px] text-ember">
                        {waiting(t.updatedAt)} waiting
                      </span>
                      <span
                        className={`font-mono text-[10px] uppercase tracking-wider ${TONE[t.state] ?? 'text-slate-dim'}`}
                      >
                        {STATE_LABEL[t.state] ?? t.state}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {rest.length > 0 && (
          <Panel title="Everything else">
            <ul className="flex flex-col gap-2">
              {rest.map((t) => (
                <li key={t.id}>
                  <a
                    href={`/support/${t.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-3 border-b border-sand-line py-2 text-sm transition-colors hover:text-accent-deep"
                  >
                    <span className="min-w-0 truncate text-slate">{t.subject}</span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                      {STATE_LABEL[t.state] ?? t.state}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          The queue is ordered by what has waited longest, not by what arrived last — a ticket
          raised on Friday that nobody has answered is the one that costs a customer, and a
          newest-first list is how it gets buried. Replies and internal notes are written on the
          ticket itself; the trail cannot be edited afterwards by anyone, including staff.
        </p>
      </div>
    </DashboardShell>
  );
}
