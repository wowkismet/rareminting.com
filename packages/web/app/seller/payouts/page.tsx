import type { Metadata } from 'next';

import { requestPayout, saveBankAccount } from '@/app/actions.ts';
import { DashboardShell, Empty, Tile } from '@/components/DashboardShell.tsx';
import { ActionForm, Field } from '@/components/Forms.tsx';
import { api } from '@/lib/api.ts';
import { loadSeller, rupees, sellerMenu } from '@/lib/seller-dashboard.ts';
import { sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Payouts' };
export const dynamic = 'force-dynamic';

interface PayoutsResponse {
  bankAccount: {
    accountMasked: string;
    ifsc: string;
    holderName: string;
    bankName: string | null;
  } | null;
  totals: {
    availableInr: number;
    requestedInr: number;
    paidInr: number;
    onHoldInr: number;
  };
  payouts: {
    id: string;
    orderNumber: string;
    title: string;
    amountInr: number;
    state: string;
    requestedAt: string | null;
    paidAt: string | null;
    reference: string | null;
  }[];
}

const STATE_LABEL: Record<string, string> = {
  pending: 'Ready to request',
  processing: 'Requested',
  paid: 'Paid',
  on_hold: 'On hold',
  failed: 'Failed',
  reversed: 'Reversed',
};

/**
 * What the seller is owed, and how to ask for it.
 *
 * Money is not pushed to sellers — they request it once an order has settled,
 * and we transfer by hand. So this page has to answer three questions plainly:
 * how much is mine, when can I have it, and where did it go.
 */
export default async function SellerPayoutsPage() {
  const { user, data } = await loadSeller();
  const token = await sessionToken();
  const result = await api<PayoutsResponse>('/v1/sellers/me/payouts', { token });

  const payoutData: PayoutsResponse = result.ok
    ? result.data
    : {
        bankAccount: null,
        totals: { availableInr: 0, requestedInr: 0, paidInr: 0, onHoldInr: 0 },
        payouts: [],
      };

  const { bankAccount, totals, payouts } = payoutData;
  const available = payouts.filter((p) => p.state === 'pending');

  return (
    <DashboardShell
      user={user}
      eyebrow="The Mint"
      title="Payouts"
      subtitle="What you have earned, and how to be paid"
      sections={sellerMenu(data)}
      current="/seller/payouts"
    >
      <div className="flex flex-col gap-10">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Tile
            label="Ready to request"
            value={rupees(totals.availableInr)}
            accent
            hint="settled orders"
          />
          <Tile
            label="Requested"
            value={rupees(totals.requestedInr)}
            hint={totals.requestedInr > 0 ? 'transfer in progress' : undefined}
          />
          <Tile label="Paid to you" value={rupees(totals.paidInr)} />
          <Tile
            label="On hold"
            value={rupees(totals.onHoldInr)}
            alert={totals.onHoldInr > 0}
          />
        </div>

        <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
            How you get paid
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-dim">
            We take <strong className="text-slate">20% commission</strong> on the sale price. GST on
            that commission and TDS under section 194-O are deducted as the law requires, and the
            rest is yours. When an order settles — the buyer has the item and the inspection window
            has closed — it appears above as ready to request. Ask for it, and we transfer to your
            bank account and record the reference here.
          </p>
        </div>

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Your bank account</h2>
          {bankAccount !== null && (
            <div className="mb-5 rounded-sm border border-sand-line bg-sand-raised p-5">
              <p className="text-sm text-slate">
                {bankAccount.holderName}
                {bankAccount.bankName !== null && ` · ${bankAccount.bankName}`}
              </p>
              <p className="mt-1 font-mono text-sm text-slate-dim">
                {bankAccount.accountMasked} · {bankAccount.ifsc}
              </p>
              <p className="mt-3 text-xs text-slate-dim">
                We show only the last four digits. Fill the form below to replace these details.
              </p>
            </div>
          )}

          <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
            <p className="mb-4 text-sm text-slate-dim">
              {bankAccount === null
                ? 'Add the account you want to be paid into. You need this before you can request a payout.'
                : 'Replace your payout account.'}
            </p>
            <ActionForm
              action={saveBankAccount}
              submitLabel={bankAccount === null ? 'Save bank account' : 'Replace bank account'}
            >
              <Field
                label="Account holder name"
                name="holderName"
                required
                placeholder="As it appears on the account"
              />
              <Field
                label="Account number"
                name="accountNumber"
                required
                placeholder="9 to 18 digits"
                hint="Stored encrypted. Only the last four digits are ever shown back to you."
              />
              <Field label="IFSC" name="ifsc" required placeholder="HDFC0001234" />
              <Field label="Bank name" name="bankName" placeholder="HDFC Bank" />
            </ActionForm>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Your payouts</h2>

          {payouts.length === 0 ? (
            <Empty action={{ href: '/seller/items', label: 'See your items' }}>
              Nothing yet. When one of your items sells and the order settles, what you are owed
              appears here to request.
            </Empty>
          ) : (
            <>
              {available.length > 0 && bankAccount === null && (
                <p className="mb-4 rounded-sm border border-accent-deep/40 bg-accent-deep/5 px-4 py-3 text-sm text-slate-dim">
                  Add your bank account above before requesting.
                </p>
              )}
              <ul className="flex flex-col gap-3">
                {payouts.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-sand-line bg-sand-raised p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-slate">{p.orderNumber}</p>
                      <p className="mt-1 text-xs text-slate-dim">
                        {p.title}
                        {p.reference !== null && (
                          <>
                            {' · '}
                            <span className="font-mono">ref {p.reference}</span>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="rounded-full border border-sand-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
                        {STATE_LABEL[p.state] ?? p.state}
                      </span>
                      <span className="font-display text-lg tabular-nums text-slate">
                        {rupees(p.amountInr)}
                      </span>
                      {p.state === 'pending' && bankAccount !== null && (
                        <form action={requestPayout}>
                          <input type="hidden" name="payoutId" value={p.id} />
                          <button
                            type="submit"
                            className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-secondary"
                          >
                            Request
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
