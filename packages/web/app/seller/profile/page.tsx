import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadSeller, rupees, sellerMenu } from '@/lib/seller-dashboard.ts';
import { sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Store profile' };
export const dynamic = 'force-dynamic';

interface PayoutsView {
  bankAccount: {
    accountMasked: string;
    ifsc: string;
    holderName: string;
    bankName: string | null;
  } | null;
}

const KYC_LABEL: Record<string, string> = {
  pending: 'Awaiting review',
  under_review: 'Under review',
  verified: 'Verified',
  rejected: 'Not approved',
  suspended: 'Suspended',
  expired: 'Expired',
};

/**
 * The store as buyers see it, and the details behind it.
 *
 * Identity is shown as the last four characters only — the numbers themselves
 * are not stored anywhere, so there is nothing fuller to show even here.
 */
export default async function SellerProfilePage() {
  const { user, data } = await loadSeller();
  const token = await sessionToken();
  const payouts = await api<PayoutsView>('/v1/sellers/me/payouts', { token });
  const bank = payouts.ok ? payouts.data.bankAccount : null;
  const { seller, stats, reviews } = data;

  return (
    <DashboardShell
      user={user}
      eyebrow="The Mint"
      title="Store profile"
      subtitle={`How buyers see ${seller.displayName}`}
      sections={sellerMenu(data)}
      current="/seller/profile"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Status"
            value={seller.approved ? 'Verified' : (KYC_LABEL[seller.kycState] ?? seller.kycState)}
            hint={seller.approved ? 'you can publish and be paid' : 'publishing opens on approval'}
            accent={seller.approved}
          />
          <StatCard label="Listings" value={String(stats.listings.total)} />
          <StatCard label="Orders" value={String(stats.sales.orders)} />
          <StatCard
            label="Rating"
            value={reviews.average === null ? '—' : `${reviews.average} / 5`}
            hint={reviews.count === 0 ? 'no reviews yet' : `from ${reviews.count}`}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="What buyers see">
            <dl className="flex flex-col gap-3 text-sm">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                  Trading as
                </dt>
                <dd className="mt-1 font-display text-xl text-slate">{seller.displayName}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                  Badge
                </dt>
                <dd className="mt-1 text-slate">
                  {seller.mintingVerified ? (
                    <span className="rounded-full border border-accent-deep/40 px-3 py-1 text-xs text-accent-deep">
                      Minting Verified
                    </span>
                  ) : (
                    <span className="text-slate-dim">
                      Awarded when an admin verifies you
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                  Selling since
                </dt>
                <dd className="mt-1 text-slate">{String(seller.createdAt).slice(0, 10)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-slate-dim">
              Your display name is the one you registered with. To change it, write to us — it
              appears on every order a buyer has placed with you, so it is not something to alter
              quietly.
            </p>
          </Panel>

          <Panel title="Your details" action={{ href: '/seller/payouts', label: 'Change bank' }}>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-dim">Email</dt>
                <dd className="text-slate">{user.email}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-dim">Verified email</dt>
                <dd className="text-slate">{user.emailVerified ? 'Yes' : 'Not yet'}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-sand-line pt-3">
                <dt className="text-slate-dim">Bank account</dt>
                <dd className="font-mono text-slate">
                  {bank === null ? 'Not added' : bank.accountMasked}
                </dd>
              </div>
              {bank !== null && (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-dim">IFSC</dt>
                    <dd className="font-mono text-slate">{bank.ifsc}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-dim">Account holder</dt>
                    <dd className="text-slate">{bank.holderName}</dd>
                  </div>
                </>
              )}
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-slate-dim">
              Your PAN and Aadhaar are not stored. They were turned into a one-way fingerprint when
              you registered, so not even an administrator can read them back — which is why they
              are not shown here.
            </p>
          </Panel>
        </div>

        <Panel title="Money" action={{ href: '/seller/payouts', label: 'Payouts' }}>
          <dl className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['Cleared to you', rupees(stats.sales.payoutInr)],
                ['Already paid out', rupees(data.payouts.paidInr)],
                ['Ready to request', rupees(data.payouts.availableInr)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                  {label}
                </dt>
                <dd className="mt-1 font-display text-xl tabular-nums text-slate">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-slate-dim">
            Commission is 20% of the sale price. GST on that commission and TDS under section 194-O
            are deducted as the law requires.
          </p>
        </Panel>
      </div>
    </DashboardShell>
  );
}
