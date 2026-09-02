import { SUGGESTED_DATES, formatLongDate, parseIsoDate } from '@/lib/search.ts';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { ListingCard } from '@/components/ListingCard.tsx';
import { api, type ApiListing } from '@/lib/api.ts';
import { currentUser } from '@/lib/session.ts';

export const dynamic = 'force-dynamic';

/**
 * The homepage.
 *
 * Everything here comes from listings that are actually for sale and links to
 * the page where they can be bought. Claims are kept to what the site can
 * currently do: no scanning, no counts we cannot evidence, and no promise of
 * an alert we have no way to send.
 */

/** Occasions people search for. The fixed ones search; the rest jump to the field. */
const OCCASIONS: readonly { emoji: string; label: string; href: string }[] = [
  { emoji: '🎂', label: 'Birthday', href: '#date' },
  { emoji: '💍', label: 'Wedding', href: '#date' },
  { emoji: '❤️', label: 'Anniversary', href: '#date' },
  { emoji: '🎓', label: 'Graduation', href: '#date' },
  { emoji: '🍼', label: 'A birth', href: '#date' },
  { emoji: '🌅', label: 'Retirement', href: '#date' },
  { emoji: '🇮🇳', label: 'Independence Day', href: '/?date=1947-08-15' },
  { emoji: '🎉', label: 'Republic Day', href: '/?date=1950-01-26' },
];

const STEPS: readonly { n: string; title: string; body: string }[] = [
  {
    n: '01',
    title: 'Enter your date',
    body: 'A birth date, an anniversary, the day a company was founded. Any date that means something to you.',
  },
  {
    n: '02',
    title: 'We read every serial number for it',
    body: 'Our engine reads each serial for the dates its digits can spell — 150890 reads as 15 August 1990 — and records every reading it finds, so the note is findable by the person the date belongs to.',
  },
  {
    n: '03',
    title: 'Buy it, gift it, or sell your own',
    body: 'Buy the note outright or make an offer. Or list your own collection, and let the people searching for that date find you.',
  },
];

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

function SectionHeading({
  overline,
  title,
  lead,
}: {
  overline: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="mb-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-accent-deep">
        {overline}
      </p>
      <h2 className="mt-2 font-display text-3xl text-slate sm:text-4xl">{title}</h2>
      {lead !== undefined && <p className="mt-3 max-w-2xl text-slate-dim">{lead}</p>}
    </div>
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

  const [dated, floor] = await Promise.all([
    target === null
      ? null
      : api<{ exact?: ApiListing[]; dayMonth?: ApiListing[] }>(`/v1/listings?date=${target.iso}`),
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
      <div className="note-field guilloche">
        <div aria-hidden className="note-field-image" />
        <div aria-hidden className="note-field-fade" />
        <div className="mx-auto max-w-6xl px-5">
          <header className="flex flex-col items-center gap-3 pt-6">
            <p className="font-display text-sm italic text-cream-dim">
              Where numbers become heirlooms.
            </p>
          </header>

          <section className="flex flex-col items-center pb-16 pt-12 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
              Date matching, read from the serial
            </p>
            <h1 className="mt-4 max-w-3xl font-display text-4xl leading-[1.1] text-cream sm:text-6xl">
              Find the note that tells your story.
            </h1>
            <p className="mt-6 max-w-xl text-cream-dim">
              Every banknote holds a story. We read the serial number of every note listed here for
              the dates its digits can spell, so the one that matches your birthday, your
              anniversary or the day everything changed is findable.
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
                className="scroll-mt-24 rounded-full border border-line bg-ink/50 px-5 py-2.5 font-mono text-cream outline-none focus-visible:border-accent"
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
            <span>Every serial read for its dates</span>
            <span>Payment held until you have the note</span>
          </div>
        </div>
      </div>

      {/* ---------- Light zone ---------- */}
      <main className="mx-auto max-w-6xl px-5 py-16">
        {results !== null && (
          <section className="mb-24">
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
                  <span className="text-slate">Same day and month,</span> a different year. The near
                  misses collectors often prefer.
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

        {/* How it works */}
        <section className="mb-24">
          <SectionHeading
            overline="How it works"
            title="How Rare Minting works"
            lead="Finding a note that carries your date is simple, and it starts with the date rather than the note."
          />
          <ol className="grid list-none gap-px overflow-hidden rounded-sm border border-sand-line bg-sand-line p-0 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="flex flex-col gap-3 bg-sand-raised p-6">
                <span className="font-mono text-2xl tabular-nums text-accent-deep">{step.n}</span>
                <h3 className="font-display text-xl text-slate">{step.title}</h3>
                <p className="text-sm leading-relaxed text-slate-dim">{step.body}</p>
              </li>
            ))}
          </ol>
          <a
            href="/how-it-works"
            className="mt-6 inline-block text-sm text-accent-deep underline underline-offset-4"
          >
            The longer version, including how we grade and how you are protected
          </a>
        </section>

        {/* Occasions */}
        <section className="mb-24">
          <SectionHeading
            overline="Occasions"
            title="For every milestone"
            lead="The dates people look for most. Pick one, or enter your own."
          />
          <div className="flex flex-wrap gap-3">
            {OCCASIONS.map((o) => (
              <a
                key={o.label}
                href={o.href}
                className="flex items-center gap-2 rounded-full border border-sand-line bg-sand-raised px-5 py-2.5 text-sm text-slate transition-colors hover:border-accent-deep"
              >
                <span aria-hidden>{o.emoji}</span>
                {o.label}
              </a>
            ))}
          </div>
        </section>

        {/* The floor */}
        <section className="mb-24">
          <SectionHeading
            overline="The Floor"
            title={listings.length === 0 ? 'The floor is opening' : 'Recently listed'}
            lead={
              listings.length === 0
                ? undefined
                : 'Notes on sale now, each one findable by the date its serial reads as.'
            }
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

        {/* Sell */}
        <section className="overflow-hidden rounded-sm border border-sand-line bg-sand-raised">
          <div className="flex flex-col gap-6 p-8 sm:p-10">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-accent-deep">
                Sell
              </p>
              <h2 className="mt-2 font-display text-3xl text-slate">
                Turn your collection into someone&rsquo;s keepsake
              </h2>
              <p className="mt-3 max-w-2xl text-slate-dim">
                Register in six details, and once an admin approves you there is no limit on how
                much you can list. Every note you add is read for its dates automatically, so the
                people searching for that day can find it.
              </p>
            </div>

            <ul className="flex list-none flex-col gap-2 p-0 text-sm text-slate-dim">
              {[
                'Free to register and free to list',
                'Every serial read for its dates, and every fancy-number pattern tagged',
                'Sell at a fixed price or take offers',
                'Payment held until the buyer has the note and the inspection window closes',
              ].map((line) => (
                <li key={line} className="border-l-2 border-accent-deep/50 pl-4">
                  {line}
                </li>
              ))}
            </ul>

            <div>
              <a
                href="/sell"
                className="inline-block rounded-full bg-primary px-8 py-3 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                Register as a seller
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter noteCount={total} />
    </div>
  );
}
