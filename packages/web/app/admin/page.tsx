import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { setKycState, moderateListing } from '@/app/actions.ts';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { api } from '@/lib/api.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface Overview {
  users: number;
  sellers: number;
  kycPending: number;
  listings: number;
  listingsLive: number;
  listingsDraft: number;
  orders: number;
  reviewOpen: number;
  disputesOpen: number;
}

interface AdminSeller {
  id: string;
  displayName: string;
  kind: string;
  kycState: string;
  mintingVerified: boolean;
  email: string;
  emailVerified: boolean;
  mobile: string | null;
  mobileVerified: boolean;
  /** Last four characters only. The numbers themselves are not stored. */
  panLast4: string | null;
  panNameAgrees: boolean | null;
  aadhaarMasked: string | null;
  listingCount: number;
}

interface AdminListing {
  id: string;
  title: string;
  state: string;
  priceInr: number | null;
  sellerName: string;
  serialDigits: string | null;
}

function Stat({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="bg-sand-raised p-4">
      <p
        className={`font-mono text-2xl tabular-nums ${alert && value > 0 ? 'text-ember' : 'text-slate'}`}
      >
        {value}
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
        {label}
      </p>
    </div>
  );
}

export default async function AdminPage() {
  const user = await currentUser();
  const token = await sessionToken();

  // The API answers 404 to a non-admin; mirror that rather than hinting the
  // console exists.
  const overview = await api<Overview>('/v1/admin/overview', { token });
  if (!overview.ok) notFound();

  const sellersResult = await api<{ sellers: AdminSeller[] }>('/v1/admin/sellers', { token });
  const listingsResult = await api<{ listings: AdminListing[] }>('/v1/admin/listings', { token });

  const sellers = sellersResult.ok ? sellersResult.data.sellers : [];
  const listings = listingsResult.ok ? listingsResult.data.listings : [];
  const o = overview.data;

  return (
    <div>
      <SiteHeader user={user} compact />

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-12">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
            Staff only
          </p>
          <h1 className="mt-2 font-display text-3xl text-slate">Admin</h1>
        </div>

        <section className="grid gap-px overflow-hidden rounded-sm border border-sand-line bg-sand-line sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Accounts" value={o.users} />
          <Stat label="Sellers" value={o.sellers} />
          <Stat label="KYC waiting" value={o.kycPending} alert />
          <Stat label="Live listings" value={o.listingsLive} />
          <Stat label="Orders" value={o.orders} />
          <Stat label="Open disputes" value={o.disputesOpen} alert />
        </section>

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Sellers</h2>
          {sellers.length === 0 ? (
            <p className="rounded-sm border border-sand-line bg-sand-raised p-6 text-sm text-slate-dim">
              No sellers registered yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-sand-line">
              <table className="w-full min-w-[46rem] border-collapse bg-sand-raised text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                    <th className="border-b border-sand-line p-3">Seller</th>
                    <th className="border-b border-sand-line p-3">Contact</th>
                    <th className="border-b border-sand-line p-3">Identity</th>
                    <th className="border-b border-sand-line p-3">Listings</th>
                    <th className="border-b border-sand-line p-3">KYC</th>
                    <th className="border-b border-sand-line p-3">Decide</th>
                  </tr>
                </thead>
                <tbody>
                  {sellers.map((s) => (
                    <tr key={s.id}>
                      <td className="border-b border-sand-line p-3 text-slate">
                        {s.displayName}
                        {s.mintingVerified && (
                          <span className="ml-2 rounded-full border border-accent-deep/40 px-2 py-0.5 text-[10px] text-accent-deep">
                            Verified
                          </span>
                        )}
                      </td>
                      <td className="border-b border-sand-line p-3 text-slate-dim">
                        <span className="block">{s.email}</span>
                        {!s.emailVerified && (
                          <span className="text-[10px] uppercase tracking-wider text-ember">
                            email unverified
                          </span>
                        )}
                        <span className="mt-1 block font-mono text-xs">{s.mobile ?? '—'}</span>
                        {s.mobile !== null && !s.mobileVerified && (
                          <span className="text-[10px] uppercase tracking-wider text-ember">
                            mobile unverified
                          </span>
                        )}
                      </td>
                      <td className="border-b border-sand-line p-3 text-slate-dim">
                        {/* Last four only — the numbers themselves are not stored. */}
                        <span className="block font-mono text-xs">
                          PAN ·····{s.panLast4 ?? '—'}
                        </span>
                        <span className="mt-1 block font-mono text-xs">
                          {s.aadhaarMasked ?? 'Aadhaar —'}
                        </span>
                        {s.panNameAgrees === false && (
                          <span className="text-[10px] uppercase tracking-wider text-ember">
                            name ≠ PAN initial
                          </span>
                        )}
                      </td>
                      <td className="border-b border-sand-line p-3 tabular-nums text-slate-dim">
                        {s.listingCount}
                      </td>
                      <td className="border-b border-sand-line p-3 text-slate-dim">{s.kycState}</td>
                      <td className="border-b border-sand-line p-3">
                        <div className="flex gap-2">
                          <form action={setKycState}>
                            <input type="hidden" name="sellerId" value={s.id} />
                            <input type="hidden" name="kycState" value="verified" />
                            <button
                              type="submit"
                              className="rounded-full bg-primary px-3 py-1 text-xs text-cream transition-colors hover:bg-secondary"
                            >
                              Verify
                            </button>
                          </form>
                          <form action={setKycState}>
                            <input type="hidden" name="sellerId" value={s.id} />
                            <input type="hidden" name="kycState" value="rejected" />
                            <input
                              type="hidden"
                              name="reason"
                              value="Documents did not satisfy verification."
                            />
                            <button
                              type="submit"
                              className="rounded-full border border-sand-line px-3 py-1 text-xs text-slate-dim transition-colors hover:border-ember hover:text-ember"
                            >
                              Reject
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Listings</h2>
          {listings.length === 0 ? (
            <p className="rounded-sm border border-sand-line bg-sand-raised p-6 text-sm text-slate-dim">
              Nothing listed yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-sand-line">
              <table className="w-full min-w-[46rem] border-collapse bg-sand-raised text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                    <th className="border-b border-sand-line p-3">Serial</th>
                    <th className="border-b border-sand-line p-3">Seller</th>
                    <th className="border-b border-sand-line p-3">Price</th>
                    <th className="border-b border-sand-line p-3">State</th>
                    <th className="border-b border-sand-line p-3">Moderate</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l) => (
                    <tr key={l.id}>
                      <td className="border-b border-sand-line p-3">
                        <a
                          href={`/listing/${l.id}`}
                          className="font-mono text-slate underline-offset-4 hover:underline"
                        >
                          {l.serialDigits ?? l.title}
                        </a>
                      </td>
                      <td className="border-b border-sand-line p-3 text-slate-dim">
                        {l.sellerName}
                      </td>
                      <td className="border-b border-sand-line p-3 tabular-nums text-slate-dim">
                        {l.priceInr === null ? '—' : `₹${l.priceInr.toLocaleString('en-IN')}`}
                      </td>
                      <td className="border-b border-sand-line p-3 text-slate-dim">{l.state}</td>
                      <td className="border-b border-sand-line p-3">
                        {l.state !== 'withdrawn' && (
                          <form action={moderateListing}>
                            <input type="hidden" name="listingId" value={l.id} />
                            <input type="hidden" name="state" value="withdrawn" />
                            <button
                              type="submit"
                              className="rounded-full border border-sand-line px-3 py-1 text-xs text-slate-dim transition-colors hover:border-ember hover:text-ember"
                            >
                              Withdraw
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
