import type { Metadata } from 'next';

import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { api, type ApiListing } from '@/lib/api.ts';
import { currentUser } from '@/lib/session.ts';

export const metadata: Metadata = {
  title: 'Browse notes',
  description: 'Every note currently for sale on Rare Minting.',
};
export const dynamic = 'force-dynamic';

/**
 * Live inventory, from the database.
 *
 * Distinct from the homepage, which still searches a seeded catalogue. This
 * page shows what sellers have actually published.
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  const date = params.date;

  const path =
    date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? `/v1/listings?date=${date}`
      : '/v1/listings?limit=48';

  const result = await api<
    { listings: ApiListing[] } & { exact?: ApiListing[]; dayMonth?: ApiListing[] }
  >(path);

  const exact = result.ok ? (result.data.exact ?? []) : [];
  const near = result.ok ? (result.data.dayMonth ?? []) : [];
  const all = result.ok ? (result.data.listings ?? []) : [];

  return (
    <div>
      <SiteHeader user={user} compact />

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-14">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
            The Floor
          </p>
          <h1 className="mt-2 font-display text-3xl text-slate sm:text-4xl">
            {date === undefined ? 'Notes for sale' : `Notes for ${date}`}
          </h1>
        </div>

        <form method="GET" className="flex flex-wrap items-center gap-3">
          <label htmlFor="date" className="sr-only">
            Find a date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={date ?? ''}
            className="rounded-full border border-sand-line bg-sand-raised px-5 py-2.5 font-mono text-slate outline-none focus-visible:border-accent-deep"
          />
          <button
            type="submit"
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
          >
            Find my date
          </button>
          {date !== undefined && (
            <a href="/browse" className="text-sm text-slate-dim underline underline-offset-4">
              Show everything
            </a>
          )}
        </form>

        {!result.ok && (
          <p className="rounded-sm border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-slate">
            {result.error.message}
          </p>
        )}

        {date === undefined ? (
          <Grid listings={all} empty="No notes are listed for sale yet." />
        ) : (
          <>
            <section>
              <h2 className="mb-4 font-display text-xl text-slate">
                Exact matches{exact.length > 0 && ` (${exact.length})`}
              </h2>
              <Grid listings={exact} empty="Nothing reads as this exact date yet." />
            </section>
            {near.length > 0 && (
              <section>
                <h2 className="mb-4 font-display text-xl text-slate">
                  Same day and month, different year
                </h2>
                <Grid listings={near} empty="" />
              </section>
            )}
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

function Grid({ listings, empty }: { listings: ApiListing[]; empty: string }) {
  if (listings.length === 0) {
    return empty === '' ? null : (
      <p className="rounded-sm border border-sand-line bg-sand-raised p-6 text-sm text-slate-dim">
        {empty}
      </p>
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {listings.map((listing) => (
        <a
          key={listing.id}
          href={`/listing/${listing.id}`}
          className="flex flex-col gap-3 rounded-sm border border-sand-line bg-sand-raised p-5 transition-colors hover:border-accent-deep/60"
        >
          <p className="font-display text-lg text-slate">{listing.title}</p>
          {listing.match !== undefined && (
            <p className="font-mono text-xs text-accent-deep">
              reads as {listing.match.iso ?? `${listing.match.day}/${listing.match.month}`}
            </p>
          )}
          <p className="mt-auto font-display text-xl text-slate">
            {listing.priceInr === null
              ? '—'
              : `₹${listing.priceInr.toLocaleString('en-IN')}`}
          </p>
        </a>
      ))}
    </div>
  );
}
