import type { Metadata } from 'next';

import { BannerSlot } from '@/components/BannerSlot.tsx';
import { BrowseFilters } from '@/components/BrowseFilters.tsx';
import { BuyerFrame } from '@/components/BuyerFrame.tsx';
import { ListingCard } from '@/components/ListingCard.tsx';
import { api, type ApiListing } from '@/lib/api.ts';

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
/** Collection names, for the heading and the empty state. */
const COLLECTION_LABEL: Record<string, string> = {
  lucky: 'Lucky notes',
  unique: 'Unique notes',
  star: 'Star notes',
  'low-serial': 'Low serials',
  radar: 'Radars',
  solid: 'Solids',
  ladder: 'Ladders',
  repeater: 'Repeaters',
  novelty: 'Novelty numbers',
};

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    pattern?: string;
    kind?: string;
    q?: string;
    price?: string;
  }>;
}) {
  const params = await searchParams;
  const date = params.date;
  const pattern = params.pattern;
  const kind = params.kind?.trim() ?? '';
  const q = params.q?.trim() ?? '';

  // One field on the wire, two bounds underneath: "2000-10000", or one side
  // left empty for an open end. Anything that is not a pair of digits is
  // treated as no filter at all rather than as an error — it can only get here
  // by being typed into the URL by hand.
  const [minPrice, maxPrice] = (() => {
    const raw = params.price ?? '';
    const m = /^(\d*)-(\d*)$/.exec(raw);
    return m === null ? ['', ''] : [m[1] ?? '', m[2] ?? ''];
  })();

  // A date search has its own shape — exact matches and near ones — so it
  // takes precedence. Everything else composes: a kind and a search term can
  // narrow the floor together.
  let path: string;
  if (date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    path = `/v1/listings?date=${date}`;
  } else {
    const search = new URLSearchParams({ limit: '48' });
    if (pattern !== undefined && /^[a-zA-Z_-]{1,24}$/.test(pattern)) {
      search.set('pattern', pattern);
    }
    if (/^[a-z_]{1,24}$/.test(kind)) search.set('kind', kind);
    if (q !== '') search.set('q', q.slice(0, 80));
    if (minPrice !== '') search.set('minPrice', minPrice);
    if (maxPrice !== '') search.set('maxPrice', maxPrice);
    path = `/v1/listings?${search.toString()}`;
  }

  const result = await api<
    { listings: ApiListing[] } & { exact?: ApiListing[]; dayMonth?: ApiListing[] }
  >(path);

  const exact = result.ok ? (result.data.exact ?? []) : [];
  const near = result.ok ? (result.data.dayMonth ?? []) : [];
  const all = result.ok ? (result.data.listings ?? []) : [];

  const collectionLabel =
    pattern === undefined ? null : (COLLECTION_LABEL[pattern.toLowerCase()] ?? pattern);

  // The heading has to say what is being shown, or a filtered floor looks like
  // an empty one.
  const KIND_LABEL: Record<string, string> = {
    banknote: 'Rare notes',
    coin: 'Rare coins',
    jewellery: 'Antique jewellery',
    precious_stone: 'Precious stones',
    antique: 'Antiques',
    stamp: 'Stamps',
    bond: 'Bonds',
    share_certificate: 'Share certificates',
    ephemera: 'Ephemera',
    other: 'Collectibles',
  };

  const heading =
    date !== undefined
      ? `Notes for ${date}`
      : q !== ''
        ? `Matching “${q}”${kind !== '' ? ` in ${(KIND_LABEL[kind] ?? kind).toLowerCase()}` : ''}`
        : (collectionLabel ?? KIND_LABEL[kind] ?? 'Notes for sale');

  return (
    <BuyerFrame current="/browse" eyebrow="The Floor" title={heading}>
      <div className="flex flex-col gap-8">
        <BannerSlot slot="browse" />

        {/* Three columns on a wide screen: filters, the floor, promotions.
            The rails collapse away below `lg` rather than stacking a filter
            panel and an advert on top of the grid — on a phone the listings
            are what the buyer came for, and the filters open from the top. */}
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)_15rem] lg:items-start">
          <aside className="lg:sticky lg:top-6">
            <BrowseFilters
              kind={kind}
              minPrice={minPrice}
              maxPrice={maxPrice}
              date={date}
              pattern={pattern}
              q={q}
            />
          </aside>

          <div className="flex min-w-0 flex-col gap-8">
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
          {(date !== undefined || collectionLabel !== null) && (
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
          <Grid
            listings={all}
            empty={
              collectionLabel === null
                ? 'No notes are listed for sale yet.'
                : 'Nothing in this collection yet. Every serial is read for these when it is listed, so this fills as stock arrives.'
            }
          />
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
          </div>

          {/* The promotional rail. Whatever an admin has put in the slot, and
              nothing at all when the slot is empty — an advertising column
              holding a placeholder is worse than one that is not there. */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
            <BannerSlot slot="browse_side" />
          </aside>
        </div>
      </div>
    </BuyerFrame>
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
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}
