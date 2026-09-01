import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { publishListing } from '@/app/actions.ts';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { api, type ApiListing } from '@/lib/api.ts';
import { currentSeller, currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Your account' };
export const dynamic = 'force-dynamic';

const STATE_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  minted: 'Live',
  reserved: 'Reserved',
  struck: 'Sold',
  withdrawn: 'Withdrawn',
  rejected: 'Rejected',
};

export default async function AccountPage() {
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const seller = await currentSeller();
  const token = await sessionToken();

  // Listings are fetched per-seller; a buyer-only account simply has none.
  let listings: ApiListing[] = [];
  if (seller !== null && token !== null) {
    const result = await api<{ listings: ApiListing[] }>('/v1/listings?limit=50', { token });
    if (result.ok) listings = result.data.listings;
  }

  return (
    <div>
      <SiteHeader user={user} compact />

      <main className="mx-auto flex max-w-4xl flex-col gap-10 px-5 py-14">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
            The Vault
          </p>
          <h1 className="mt-2 font-display text-3xl text-slate">
            {user.fullName ?? 'Your account'}
          </h1>
          <p className="mt-2 text-sm text-slate-dim">
            {user.email}
            {!user.emailVerified && (
              <span className="ml-2 rounded-full border border-sand-line px-2 py-0.5 text-xs">
                email not verified
              </span>
            )}
          </p>
        </div>

        <section className="rounded-sm border border-sand-line bg-sand-raised p-6">
          <h2 className="font-display text-xl text-slate">Selling</h2>
          {seller === null ? (
            <>
              <p className="mt-2 text-sm text-slate-dim">
                You have not registered as a seller yet.
              </p>
              <a
                href="/sell"
                className="mt-5 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                Register as a seller
              </a>
            </>
          ) : (
            <>
              <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-dim">Trading as</dt>
                  <dd className="text-slate">{seller.displayName}</dd>
                </div>
                <div>
                  <dt className="text-slate-dim">Verification</dt>
                  <dd className="text-slate">
                    {seller.mintingVerified ? 'Minting Verified' : `KYC ${seller.kycState}`}
                  </dd>
                </div>
              </dl>
              <a
                href="/sell"
                className="mt-5 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                List a note
              </a>
            </>
          )}
        </section>

        {seller !== null && (
          <section>
            <h2 className="mb-4 font-display text-xl text-slate">Your listings</h2>

            {listings.length === 0 ? (
              <p className="rounded-sm border border-sand-line bg-sand-raised p-6 text-sm text-slate-dim">
                Nothing listed yet. The first note you add appears here.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {listings.map((listing) => (
                  <li
                    key={listing.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-sand-line bg-sand-raised p-4"
                  >
                    <div className="min-w-0">
                      <a
                        href={`/listing/${listing.id}`}
                        className="font-mono text-sm text-slate underline-offset-4 hover:underline"
                      >
                        {listing.note?.serialDigits ?? listing.title}
                      </a>
                      <p className="mt-1 text-xs text-slate-dim">
                        {listing.note ? `₹${listing.note.denomination} · ` : ''}
                        {listing.grade ?? 'ungraded'}
                        {listing.priceInr !== null &&
                          ` · ₹${listing.priceInr.toLocaleString('en-IN')}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="rounded-full border border-sand-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
                        {STATE_LABEL[listing.state] ?? listing.state}
                      </span>
                      {listing.state === 'draft' && (
                        <form action={publishListing}>
                          <input type="hidden" name="id" value={listing.id} />
                          <button
                            type="submit"
                            className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-secondary"
                          >
                            Publish
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
