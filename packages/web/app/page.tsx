import { SUGGESTED_DATES, formatLongDate, parseIsoDate } from '@/lib/search.ts';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { api, type ApiListing } from '@/lib/api.ts';
import { currentUser } from '@/lib/session.ts';

export const dynamic = 'force-dynamic';

/**
 * The homepage, against the real database.
 *
 * It used to search a seeded catalogue of two hundred invented notes. That made
 * a good demonstration and a bad shopfront: it advertised a stock level that
 * did not exist, and a visitor who found their date could not buy the note,
 * because there was no note. Everything here now comes from listings that are
 * actually for sale and links to the page where they can be bought.
 */

/** The pitch made concrete: a real serial with its date digits picked out. */
function HeroSerial({ prefix, digits }: { prefix: string; digits: string }) {
  return (
    <div className="mt-10">
      <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-accent">Serial number</p>
      <p className="mt-3 font-mono text-3xl tracking-[0.22em] tabular-nums sm:text-4xl">
        <span className="text-cream-dim">{prefix}</span>
        {digits.split('').map((digit, index) => (
          <span key={index} className="engraved text-accent-bright">
            {digit}
          </span>
        ))}
      </p>
      <p className="mt-3 text-xs text-cream-dim">DDMMYY date digits highlighted in gold</p>
    </div>
  );
}

function SectionHeading({ overline, title }: { overline: string; title: string }) {
  return (
    <div className="mb-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-accent-deep">
        {overline}
      </p>
      <h2 className="mt-2 text-3xl text-slate sm:text-4xl">{title}</h2>
    </div>
  );
}

/** A listing card. Always a link — every card here is something purchasable. */
function ListingCard({ listing, badge }: { listing: ApiListing; badge?: string }) {
  const note = listing.note;
  return (
    <a
      href={`/listing/${listing.id}`}
      className="flex flex-col gap-3 rounded-sm border border-sand-line bg-sand-raised p-5 transition-colors hover:border-accent-deep/60"
    >
      {listing.imageUrl != null ? (
        <img
          src={listing.imageUrl}
          alt={listing.title}
          loading="lazy"
          className="aspect-[2/1] w-full rounded-sm border border-sand-line object-cover"
        />
      ) : (
        <div className="flex aspect-[2/1] w-full items-center justify-center rounded-sm border border-dashed border-sand-line text-xs text-slate-dim">
          No photograph yet
        </div>
      )}

      {badge !== undefined && (
        <span className="self-start rounded-full border border-accent-deep/40 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent-deep">
          {badge}
        </span>
      )}

      {note !== undefined ? (
        <p className="font-mono text-lg tracking-[0.12em] tabular-nums text-slate">
          {note.prefix !== null && (
            <span className="text-slate-dim">
              {note.prefix}
              {note.isStar && <span className="text-ember">*</span>}{' '}
            </span>
          )}
          {note.serialDigits}
        </p>
      ) : (
        <p className="font-display text-lg text-slate">{listing.title}</p>
      )}

      <p className="text-xs text-slate-dim">
        {note !== undefined && `₹${note.denomination} · `}
        {listing.grade ?? 'ungraded'}
      </p>

      {listing.match !== undefined && (
        <p className="font-mono text-xs text-accent-deep">
          reads as {listing.match.iso ?? `${listing.match.day}/${listing.match.month}`}
        </p>
      )}

      <p className="mt-auto font-display text-xl text-slate">
        {listing.priceInr === null ? '—' : `₹${listing.priceInr.toLocaleString('en-IN')}`}
      </p>
    </a>
  );
}

interface Found {
  exact: ApiListing[];
  dayMonth: ApiListing[];
  iso: string;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  const target = parseIsoDate(params.date);

  // Two calls: what matches the requested date, and what is on the floor.
  const [dated, floor] = await Promise.all([
    target === null
      ? null
      : api<{ exact?: ApiListing[]; dayMonth?: ApiListing[] }>(
          `/v1/listings?date=${target.iso}`,
        ),
    api<{ listings: ApiListing[]; total?: number }>('/v1/listings?limit=6'),
  ]);

  const results: Found | null =
    target === null || dated === null || !dated.ok
      ? null
      : {
          exact: dated.data.exact ?? [],
          dayMonth: dated.data.dayMonth ?? [],
          iso: target.iso,
        };

  const listings = floor.ok ? floor.data.listings : [];
  const total = floor.ok ? (floor.data.total ?? listings.length) : 0;

  return (
    <div>
      <SiteHeader user={user} />

      {/* ---------- Dark zone: hero ---------- */}
      <div className="guilloche bg-primary">
        <div className="mx-auto max-w-6xl px-5">
          <header className="flex flex-col items-center gap-3 pt-6">
            <p className="font-display text-sm italic text-cream-dim">
              Where numbers become heirlooms.
            </p>
          </header>

          <section className="flex flex-col items-center pb-16 pt-12 text-center">
            <h1 className="max-w-3xl font-display text-4xl leading-[1.1] text-cream sm:text-6xl">
              Find the banknote that carries your date.
            </h1>
            <p className="mt-6 max-w-xl text-cream-dim">
              A birthday, an anniversary, the day a company was founded. Every serial number is read
              for the dates it can mean, so the note that matters to you is findable.
            </p>

            <HeroSerial prefix="9AB" digits="150892" />

            <form action="/" method="GET" className="mt-10 flex flex-wrap justify-center gap-3">
              <label htmlFor="date" className="sr-only">
                Your date
              </label>
              <input
                id="date"
                name="date"
                type="date"
                defaultValue={params.date ?? ''}
                className="rounded-full border border-line bg-ink/50 px-5 py-2.5 font-mono text-cream outline-none focus-visible:border-accent"
              />
              <button
                type="submit"
                className="rounded-full bg-accent px-7 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-accent-bright"
              >
                Find my date
              </button>
            </form>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTED_DATES.map((suggestion) => (
                <a
                  key={suggestion.iso}
                  href={`/?date=${suggestion.iso}`}
                  className="rounded-full border border-line px-4 py-1.5 font-mono text-[11px] text-cream-dim transition-colors hover:border-accent hover:text-accent-bright focus-visible:border-accent focus-visible:text-accent-bright"
                >
                  {suggestion.label}
                </a>
              ))}
            </div>
          </section>
        </div>

        <div className="border-t border-line/70 bg-ink/40">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-4 font-mono text-[11px] uppercase tracking-[0.2em] text-cream-dim">
            <span>
              {total} {total === 1 ? 'note' : 'notes'} for sale
            </span>
            <span>Engine-verified date matching</span>
            <span>Certificate of authenticity</span>
          </div>
        </div>
      </div>

      {/* ---------- Light zone: the catalogue ---------- */}
      <main className="mx-auto max-w-6xl px-5 py-16">
        {results !== null && (
          <section className="mb-20">
            <SectionHeading
              overline={(() => {
                const found = results.exact.length + results.dayMonth.length;
                return `${found} ${found === 1 ? 'match' : 'matches'} in ${total} for sale`;
              })()}
              title={formatLongDate(results.iso)}
            />

            {results.exact.length > 0 ? (
              <>
                <p className="mb-6 text-sm text-slate-dim">
                  <span className="text-accent-deep">Exact matches.</span> The serial reads as your
                  date, digit for digit.
                </p>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {results.exact.map((listing) => (
                    <ListingCard key={listing.id} listing={listing} badge="Exact" />
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-sm border border-sand-line bg-sand-raised p-10 text-center">
                <p className="font-display text-2xl text-slate">
                  Nothing for sale reads as {formatLongDate(results.iso)} yet.
                </p>
                <p className="mx-auto mt-3 max-w-md text-sm text-slate-dim">
                  New notes are listed continually. Check back, or browse everything currently on
                  the floor.
                </p>
                <a
                  href="/browse"
                  className="mt-7 inline-block rounded-full bg-primary px-8 py-3 text-sm font-medium text-cream transition-colors hover:bg-secondary"
                >
                  Browse every note
                </a>
              </div>
            )}

            {results.dayMonth.length > 0 && (
              <div className="mt-14">
                <p className="mb-6 text-sm text-slate-dim">
                  <span className="text-slate">Same day and month,</span> a different year. The
                  near misses collectors often prefer.
                </p>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {results.dayMonth.slice(0, 6).map((listing) => (
                    <ListingCard key={listing.id} listing={listing} badge="Near" />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* What is actually on the floor right now. */}
        <section>
          <SectionHeading
            overline="The Floor"
            title={listings.length === 0 ? 'The floor is opening' : 'Recently listed'}
          />

          {listings.length === 0 ? (
            <div className="rounded-sm border border-sand-line bg-sand-raised p-10 text-center">
              <p className="font-display text-2xl text-slate">No notes are for sale yet.</p>
              <p className="mx-auto mt-3 max-w-md text-sm text-slate-dim">
                Sellers are being verified now. If you have a note with a serial worth finding, you
                can be among the first to list it.
              </p>
              <a
                href="/sell"
                className="mt-7 inline-block rounded-full bg-primary px-8 py-3 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                Sell a note
              </a>
            </div>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
              {total > listings.length && (
                <a
                  href="/browse"
                  className="mt-8 inline-block rounded-full border border-sand-line px-6 py-2.5 text-sm text-slate transition-colors hover:border-accent-deep"
                >
                  Browse all {total} notes
                </a>
              )}
            </>
          )}
        </section>
      </main>

      <SiteFooter noteCount={total} />
    </div>
  );
}
