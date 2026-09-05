import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { addToCart, buyNow, publishListing, saveForLater, uploadPhoto } from '@/app/actions.ts';
import { NotePhotos, PhotoUpload } from '@/components/NotePhotos.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { api, type ApiListing } from '@/lib/api.ts';
import { formatDayFirst, formatDayMonth } from '@/lib/search.ts';
import { DashboardShell } from '@/components/DashboardShell.tsx';
import { loadSellerOrNull, sellerMenu } from '@/lib/seller-dashboard.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Listing' };

const ERA: Record<string, string> = {
  heritage: 'Heritage',
  historic: 'Historic',
  modern: 'Modern',
  recent: 'Recent',
  future: 'Future',
};

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const user = await currentUser();
  const token = await sessionToken();

  const result = await api<{ listing: ApiListing }>(`/v1/listings/${id}`, { token });
  if (!result.ok) notFound();

  const listing = result.data.listing;

  // Compare seller ids. The previous check asked only "is this person a
  // seller?", which was true for every seller on the site — so everyone saw an
  // upload form on everyone else's listing. The API refused those uploads, but
  // the page was still telling people something untrue.
  const me = user === null ? null : await api<{ seller: { id: string } }>('/v1/sellers/me', { token });
  const isOwner =
    me !== null && me.ok && listing.sellerId !== undefined && me.data.seller.id === listing.sellerId;
  const note = listing.note;
  const best = listing.dates?.[0];

  // The seller looking at their own item keeps the dashboard around them; a
  // buyer gets the public page. Same content either way — only the furniture
  // differs, because a seller menu shown to a buyer would be nonsense.
  const dash = isOwner ? await loadSellerOrNull() : null;

  const body = (
    <>
      <div className="flex flex-col gap-8">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
            {listing.state === 'minted' ? 'Minted' : listing.state}
          </p>
          {dash === null && (
            <h1 className="mt-2 font-display text-3xl text-slate">{listing.title}</h1>
          )}
        </div>

        <NotePhotos media={listing.media ?? []} title={listing.title} />

        {/* A listing with no picture does not sell, so for its owner the
            uploader belongs at the top of the page rather than beneath the
            fold. Once there is a photograph it moves back down, out of the
            way of the thing the seller came to look at. */}
        {isOwner && (listing.media ?? []).length === 0 && (
          <PhotoUpload listingId={listing.id} action={uploadPhoto} />
        )}

        {/* The serial, as the hero. Dark plate on the cream page, like a
            banknote window set into the card. */}
        {note !== undefined && (
          <div className="guilloche rounded-sm border border-line bg-primary px-6 py-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
              Serial number
            </p>
            <p className="mt-3 font-mono text-3xl tracking-[0.18em] tabular-nums text-cream sm:text-4xl">
              {note.prefix !== null && (
                <span className="text-cream-dim text-xl">
                  {note.prefix}
                  {note.isStar && <span className="text-ember">*</span>}{' '}
                </span>
              )}
              <span className="engraved text-accent-bright">{note.serialDigits}</span>
            </p>
            <p className="mt-3 text-xs text-cream-dim">
              ₹{note.denomination} · {note.series}
              {note.isStar && ' · star series replacement note'}
            </p>
          </div>
        )}

        {/* A coin has no serial plate, so its attributes take that place. */}
        {listing.collectible !== undefined && (
          <div className="rounded-sm border border-sand-line bg-sand-raised px-6 py-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
              {listing.kind === 'coin' ? 'The coin' : 'The piece'}
            </p>
            <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {(
                [
                  ['Year of issue', listing.collectible.yearOfIssue],
                  [
                    'Face value',
                    listing.collectible.denomination === null
                      ? null
                      : `₹${listing.collectible.denomination}`,
                  ],
                  ['Metal', listing.collectible.metal],
                  ['Mint mark', listing.collectible.mintMark],
                  [
                    'Weight',
                    listing.collectible.weightGrams === null
                      ? null
                      : `${listing.collectible.weightGrams} g`,
                  ],
                  ['Catalogue', listing.collectible.catalogueRef],
                ] as const
              )
                .filter(([, value]) => value !== null && value !== '')
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
                      {label}
                    </dt>
                    <dd className="mt-1 text-slate">{value}</dd>
                  </div>
                ))}
            </dl>
          </div>
        )}

        <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
              Price
            </dt>
            <dd className="mt-1 font-display text-2xl text-slate">
              {listing.priceInr === null
                ? 'Not priced'
                : `₹${listing.priceInr.toLocaleString('en-IN')}`}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
              Condition
            </dt>
            <dd className="mt-1 text-slate">{listing.grade ?? 'Not graded'}</dd>
          </div>
        </dl>

        {best !== undefined && (
          <section>
            <h2 className="font-display text-xl text-slate">What this serial reads as</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {listing.dates?.map((d, i) => (
                <li
                  key={`${d.iso ?? 'partial'}-${i}`}
                  className="flex flex-wrap items-baseline justify-between gap-3 rounded-sm border border-sand-line bg-sand-raised px-4 py-3"
                >
                  <span className="font-mono text-slate">
                    {d.isPartial || d.iso === null
                      ? `${formatDayMonth(d.day, d.month)} (no year)`
                      : formatDayFirst(d.iso)}
                  </span>
                  <span className="text-xs text-slate-dim">
                    {d.era !== null && `${ERA[d.era] ?? d.era} · `}
                    {Math.round(d.confidence * 100)}% confidence
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {listing.patterns !== undefined && listing.patterns.length > 0 && (
          <section>
            <h2 className="font-display text-xl text-slate">What makes it collectible</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {listing.patterns.map((p) => (
                <li
                  key={`${p.code}-${p.detail ?? ''}`}
                  title={p.detail ?? undefined}
                  className="rounded-full border border-accent-deep/40 px-3 py-1 text-xs text-accent-deep"
                >
                  {p.label}
                </li>
              ))}
            </ul>
          </section>
        )}

        {error !== undefined && (
          <p
            role="alert"
            className="rounded-sm border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-slate"
          >
            {error}
          </p>
        )}

        {listing.state === 'minted' && (
          <div className="flex flex-wrap items-center gap-4 rounded-sm border border-accent-deep/40 bg-sand-raised p-5">
            <form action={buyNow}>
              <input type="hidden" name="listingId" value={listing.id} />
              <button
                type="submit"
                className="rounded-full bg-primary px-8 py-3 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                Buy now
                {listing.priceInr !== null &&
                  ` · ₹${listing.priceInr.toLocaleString('en-IN')}`}
              </button>
            </form>
            {user !== null && !isOwner && (
              <>
                <form action={addToCart}>
                  <input type="hidden" name="listingId" value={listing.id} />
                  <button
                    type="submit"
                    className="rounded-full border border-sand-line px-6 py-3 text-sm text-slate transition-colors hover:border-accent-deep"
                  >
                    Add to cart
                  </button>
                </form>
                <form action={saveForLater}>
                  <input type="hidden" name="listingId" value={listing.id} />
                  <button
                    type="submit"
                    className="rounded-full border border-sand-line px-6 py-3 text-sm text-slate-dim transition-colors hover:border-accent-deep hover:text-slate"
                  >
                    Save for later
                  </button>
                </form>
              </>
            )}
            <p className="text-xs text-slate-dim">
              Your payment is held until the note reaches you and the{' '}
              <a href="/refunds" className="underline underline-offset-4">
                inspection window
              </a>{' '}
              closes.
            </p>
          </div>
        )}

        {listing.state === 'reserved' && (
          <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm text-slate-dim">
            This note is reserved for another buyer.
          </p>
        )}

        {isOwner && (listing.media ?? []).length > 0 && (
          <PhotoUpload listingId={listing.id} action={uploadPhoto} />
        )}

        {listing.state === 'draft' && (
          <form action={publishListing} className="rounded-sm border border-sand-line bg-sand-raised p-5">
            <input type="hidden" name="id" value={listing.id} />
            <p className="text-sm text-slate-dim">
              This is a draft. Nobody else can see it until you publish.
            </p>
            <button
              type="submit"
              className="mt-4 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
            >
              Publish listing
            </button>
          </form>
        )}
      </div>
    </>
  );

  if (dash !== null) {
    return (
      <DashboardShell
        user={dash.user}
        eyebrow="The Mint"
        title={listing.title}
        subtitle={`Your item · ${listing.state}`}
        sections={sellerMenu(dash.data)}
        current="/seller/items"
      >
        <div className="max-w-3xl">{body}</div>
      </DashboardShell>
    );
  }

  return (
    <div>
      <SiteHeader user={user} compact />
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-14">{body}</main>
      <SiteFooter />
    </div>
  );
}
