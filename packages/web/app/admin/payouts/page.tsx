import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { holdPayout, markPayoutPaid } from '@/app/actions.ts';
import { DashboardShell, type MenuSection } from '@/components/DashboardShell.tsx';
import { api } from '@/lib/api.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = {
  title: 'Payouts',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface AdminPayout {
  id: string;
  orderNumber: string;
  sellerName: string;
  amountInr: number;
  state: string;
  requestedAt: string | null;
  reference: string | null;
  bank: {
    holderName: string | null;
    bankName: string | null;
    ifsc: string | null;
    accountMasked: string;
    accountNumber?: string;
  } | null;
}

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

/**
 * The transfer queue.
 *
 * The one screen where a full bank account number can be shown, because a
 * transfer cannot be made without it. It stays masked until an admin asks, and
 * asking is written to the audit log — so there is always a record of who
 * looked at whose bank details, and when.
 */
export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ reveal?: string }>;
}) {
  const { reveal } = await searchParams;
  const user = await currentUser();
  const token = await sessionToken();
  const revealing = reveal === 'true';

  const result = await api<{ payouts: AdminPayout[] }>(
    `/v1/admin/payouts${revealing ? '?reveal=true' : ''}`,
    { token },
  );
  if (!result.ok) notFound();

  const payouts = result.data.payouts;
  const requested = payouts.filter((p) => p.state === 'processing');
  const owed = requested.reduce((sum, p) => sum + p.amountInr, 0);

  const sections: MenuSection[] = [
    {
      title: 'Review',
      items: [
        { href: '/admin', label: 'Overview' },
        { href: '/admin#sellers', label: 'Sellers' },
        { href: '/admin#listings', label: 'Listings' },
        { href: '/admin/payouts', label: 'Payouts', badge: requested.length },
      ],
    },
    {
      title: 'Site',
      items: [
        { href: '/browse', label: 'The floor' },
        { href: '/seller', label: 'Seller view' },
        { href: '/account', label: 'Buyer view' },
      ],
    },
  ];

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Payouts"
      subtitle={
        requested.length === 0
          ? 'No transfers requested'
          : `${requested.length} requested · ${rupees(owed)} to transfer`
      }
      sections={sections}
      current="/admin/payouts"
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-accent-deep/40 bg-sand-raised p-5">
          <p className="max-w-xl text-sm leading-relaxed text-slate-dim">
            Account numbers are hidden by default. Revealing them is recorded in the audit log
            against your account, so reveal only when you are about to make a transfer.
          </p>
          <a
            href={revealing ? '/admin/payouts' : '/admin/payouts?reveal=true'}
            className="rounded-full border border-sand-line px-5 py-2 text-sm text-slate transition-colors hover:border-accent-deep"
          >
            {revealing ? 'Hide account numbers' : 'Reveal account numbers'}
          </a>
        </div>

        {payouts.length === 0 ? (
          <p className="rounded-sm border border-sand-line bg-sand-raised p-6 text-sm text-slate-dim">
            No payouts are waiting. One appears here when a seller requests money on a settled
            order.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {payouts.map((p) => (
              <li key={p.id} className="rounded-sm border border-sand-line bg-sand-raised p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <p className="font-display text-lg text-slate">{p.sellerName}</p>
                    <p className="mt-1 font-mono text-xs text-slate-dim">
                      order {p.orderNumber}
                      {p.requestedAt !== null && ` · requested ${p.requestedAt.slice(0, 10)}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-2xl tabular-nums text-slate">
                      {rupees(p.amountInr)}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
                      {p.state === 'processing' ? 'requested' : p.state.replace(/_/g, ' ')}
                    </p>
                  </div>
                </div>

                {p.bank === null ? (
                  <p className="mt-4 text-sm text-ember">
                    No bank account on file — the seller must add one before this can be paid.
                  </p>
                ) : (
                  <dl className="mt-4 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                    <div className="flex gap-2">
                      <dt className="text-slate-dim">Name</dt>
                      <dd className="text-slate">{p.bank.holderName}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-slate-dim">IFSC</dt>
                      <dd className="font-mono text-slate">{p.bank.ifsc}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-slate-dim">Account</dt>
                      <dd className="font-mono text-slate">
                        {p.bank.accountNumber ?? p.bank.accountMasked}
                      </dd>
                    </div>
                    {p.bank.bankName !== null && (
                      <div className="flex gap-2">
                        <dt className="text-slate-dim">Bank</dt>
                        <dd className="text-slate">{p.bank.bankName}</dd>
                      </div>
                    )}
                  </dl>
                )}

                {p.state !== 'on_hold' && (
                  <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-sand-line pt-4">
                    <form action={markPayoutPaid} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="payoutId" value={p.id} />
                      <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                          Bank reference (UTR)
                        </span>
                        <input
                          name="reference"
                          required
                          placeholder="UTR number"
                          className="rounded-sm border border-sand-line bg-sand px-3 py-2 font-mono text-sm text-slate outline-none focus-visible:border-accent-deep"
                        />
                      </label>
                      <button
                        type="submit"
                        className="rounded-full bg-primary px-5 py-2 text-xs font-medium text-cream transition-colors hover:bg-secondary"
                      >
                        Mark transferred
                      </button>
                    </form>

                    <form action={holdPayout} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="payoutId" value={p.id} />
                      <input type="hidden" name="reason" value="Held for review" />
                      <button
                        type="submit"
                        className="rounded-full border border-sand-line px-5 py-2 text-xs text-slate-dim transition-colors hover:border-ember hover:text-ember"
                      >
                        Hold
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardShell>
  );
}
