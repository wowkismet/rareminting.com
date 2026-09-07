import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { setKycState } from '@/app/actions.ts';
import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin } from '@/lib/admin-dashboard.ts';
import type { AdminSeller } from '@/components/SellerTable.tsx';

export const metadata: Metadata = {
  title: 'KYC review',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface Document {
  id: string;
  kind: string;
  label: string;
  state: string;
  last4: string | null;
  nameMatches: boolean | null;
  rejectionReason: string | null;
  hasFile: boolean;
  createdAt: string;
}

/** What a complete file looks like. Anything missing is worth seeing as missing. */
const EXPECTED = [
  ['pan', 'PAN card'],
  ['aadhaar_masked', 'Aadhaar (masked)'],
  ['bank_proof', 'Cancelled cheque'],
] as const;

/**
 * One seller, everything needed to decide, on one page.
 *
 * Approving a seller is what lets them publish and be paid, so it should not
 * be done from a row in a table with the documents on another screen. The
 * identity numbers are absent because they do not exist to show: registration
 * turned each into a one-way fingerprint and its last four characters, so what
 * a reviewer does is check the card against those four — which is why the
 * last four sit beside each document rather than somewhere else.
 */
export default async function KycReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, token, sections } = await loadAdmin();

  const [sellersResult, docsResult] = await Promise.all([
    api<{ sellers: AdminSeller[] }>('/v1/admin/sellers', { token }),
    api<{ documents: Document[] }>(`/v1/admin/sellers/${id}/documents`, { token }),
  ]);

  const seller = sellersResult.ok
    ? sellersResult.data.sellers.find((s) => s.id === id)
    : undefined;
  if (seller === undefined) notFound();

  const documents = docsResult.ok ? docsResult.data.documents : [];
  const byKind = new Map(documents.map((d) => [d.kind, d]));
  const missing = EXPECTED.filter(([kind]) => !byKind.has(kind) || !byKind.get(kind)!.hasFile);

  const detail = (label: string, value: string, tone?: string) => (
    <div key={label} className="flex items-baseline justify-between gap-3 border-b border-sand-line py-2">
      <dt className="text-sm text-slate-dim">{label}</dt>
      <dd className={`text-sm ${tone ?? 'text-slate'}`}>{value}</dd>
    </div>
  );

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title={seller.displayName}
      subtitle={`KYC review · ${seller.kycState.replace(/_/g, ' ')}`}
      sections={sections}
      current="/admin/kyc"
    >
      <div className="flex max-w-4xl flex-col gap-6">
        {missing.length > 0 && (
          <div className="rounded-sm border border-ember/40 bg-ember/5 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ember">
              Not yet sent
            </p>
            <p className="mt-2 text-sm text-slate-dim">
              {missing.map(([, label]) => label).join(', ')}. Approving without these means
              approving on the seller&rsquo;s word alone.
            </p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Who they say they are">
            <dl className="flex flex-col">
              {detail('Trading as', seller.displayName)}
              {detail('Type', seller.kind)}
              {detail('Email', seller.email, seller.emailVerified ? 'text-slate' : 'text-ember')}
              {detail(
                'Email verified',
                seller.emailVerified ? 'Yes' : 'No',
                seller.emailVerified ? 'text-slate' : 'text-ember',
              )}
              {detail('Mobile', seller.mobile ?? '—')}
              {detail(
                'Mobile verified',
                seller.mobile === null ? '—' : seller.mobileVerified ? 'Yes' : 'No',
                seller.mobileVerified ? 'text-slate' : 'text-ember',
              )}
              {detail('Listings', String(seller.listingCount))}
              {detail('Registered', seller.createdAt.slice(0, 10))}
            </dl>
          </Panel>

          <Panel title="What we hold">
            <dl className="flex flex-col">
              {detail('PAN, last four', seller.panLast4 ?? '—')}
              {detail(
                'Name against PAN',
                seller.panNameAgrees === null
                  ? 'not checked'
                  : seller.panNameAgrees
                    ? 'agrees'
                    : 'does not agree',
                seller.panNameAgrees === false ? 'text-ember' : 'text-slate',
              )}
              {detail('Aadhaar', seller.aadhaarMasked ?? '—')}
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-slate-dim">
              The numbers themselves are not stored anywhere and cannot be shown, here or to
              anyone. Each became a one-way fingerprint at registration. Check the card against the
              last four above — that is what they are for.
            </p>
          </Panel>
        </div>

        <Panel title="Documents">
          {documents.length === 0 ? (
            <p className="text-sm text-slate-dim">
              Nothing sent in yet. The seller uploads these from their store profile.
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {documents.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-col gap-2 rounded-sm border border-sand-line bg-sand-raised p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-slate">{d.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                      {d.state}
                    </span>
                  </div>
                  {d.last4 !== null && (
                    <p className="font-mono text-xs text-slate-dim">ends {d.last4}</p>
                  )}
                  {d.nameMatches === false && (
                    <p className="text-xs text-ember">name does not agree with the card</p>
                  )}
                  {d.hasFile ? (
                    <a
                      href={`/api/v1/kyc-documents/${d.id}/file`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block w-fit rounded-full border border-sand-line px-4 py-1.5 text-xs text-slate transition-colors hover:border-accent-deep hover:text-accent-deep"
                    >
                      Open document ↗
                    </a>
                  ) : (
                    <p className="text-xs text-slate-dim">No file — number on record only</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs leading-relaxed text-slate-dim">
            Opening a document is recorded against your account in the audit log, with the time and
            which document. That is deliberate: these are somebody&rsquo;s identity papers.
          </p>
        </Panel>

        <Panel title="Decide">
          <div className="flex flex-wrap gap-3">
            <form action={setKycState}>
              <input type="hidden" name="sellerId" value={seller.id} />
              <input type="hidden" name="kycState" value="verified" />
              <button
                type="submit"
                className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                Approve
              </button>
            </form>
            <form action={setKycState} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="sellerId" value={seller.id} />
              <input type="hidden" name="kycState" value="rejected" />
              <input
                name="reason"
                required
                placeholder="Why — the seller is told this"
                className="min-w-56 rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              />
              <button
                type="submit"
                className="rounded-full border border-sand-line px-5 py-2 text-sm text-slate-dim transition-colors hover:border-ember hover:text-ember"
              >
                Reject
              </button>
            </form>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-slate-dim">
            Approving lets this seller publish without limit and be paid. Rejecting requires a
            reason because the seller is shown it — &ldquo;documents not satisfactory&rdquo; tells
            them nothing they can act on, and they will simply write in asking what to fix.
          </p>
        </Panel>
      </div>
    </DashboardShell>
  );
}
