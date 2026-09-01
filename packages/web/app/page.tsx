import Image from 'next/image';

import { CATALOGUE, tagCounts, topByRarity } from '@/lib/catalogue.ts';
import { SUGGESTED_DATES, formatLongDate, parseIsoDate, search } from '@/lib/search.ts';
import { NoteCard } from '@/components/NoteCard.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';

export const dynamic = 'force-dynamic';

/**
 * The logo already carries its own gold rules and flourish, so it is given
 * space rather than the engraved hairlines the text wordmark needed.
 *
 * `h1` wraps it because this is the page's primary heading; the alt text is
 * what a screen reader and a search engine actually read.
 */
function Wordmark() {
  return (
    <h1 className="flex justify-center">
      <Image
        src="/rare-minting-logo.png"
        alt="Rare Minting"
        width={2171}
        height={724}
        priority
        sizes="(min-width: 640px) 420px, 300px"
        className="h-auto w-[300px] sm:w-[420px]"
      />
    </h1>
  );
}

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

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const target = parseIsoDate(params.date);
  const results = target === null ? null : search(target.iso);
  const rails = tagCounts().slice(0, 8);
  const featured = topByRarity(3);

  return (
    <div>
      {/* ---------- Dark zone: masthead and hero ---------- */}
      <div className="guilloche bg-primary">
        <div className="mx-auto max-w-6xl px-5">
          <header className="flex flex-col items-center gap-3 py-12">
            <Wordmark />
            <p className="font-display text-sm italic text-cream-dim">
              Where numbers become heirlooms.
            </p>
          </header>

          <section className="pb-16 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-accent-bright">
              The Archive
            </p>
            <h2 className="mx-auto mt-5 max-w-3xl text-4xl leading-[1.15] text-cream sm:text-6xl">
              Find the note that tells your story.
            </h2>

            <HeroSerial prefix="5AB " digits="150892" />

            <p className="mx-auto mt-8 max-w-xl text-sm leading-relaxed text-cream-dim">
              Our engine reads banknote serial numbers and matches them to birth dates,
              anniversaries and life events. Every note is a keepsake waiting to be found.
            </p>

            <form method="GET" className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <label htmlFor="date" className="sr-only">
                Your date
              </label>
              <input
                id="date"
                type="date"
                name="date"
                defaultValue={target?.iso ?? ''}
                className="rounded-full border border-line bg-ink px-6 py-3 font-mono text-cream outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent"
              />
              <button
                type="submit"
                className="rounded-full bg-accent px-8 py-3 text-sm font-medium text-ink transition-colors hover:bg-accent-bright focus-visible:bg-accent-bright"
              >
                Find my date
              </button>
            </form>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className="text-cream-dim">Try:</span>
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
            <span>{CATALOGUE.length} notes listed</span>
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
                const total = results.exact.length + results.dayMonth.length;
                return `${total} ${total === 1 ? 'match' : 'matches'} in ${CATALOGUE.length} notes`;
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
                  {results.exact.map((match) => (
                    <NoteCard
                      key={match.entry.id}
                      entry={match.entry}
                      interpretation={match.interpretation}
                      badge="Exact"
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-sm border border-sand-line bg-sand-raised p-10 text-center">
                <p className="font-display text-2xl text-slate">
                  Nothing in the vault reads as {formatLongDate(results.iso)} yet.
                </p>
                <p className="mx-auto mt-3 max-w-md text-sm text-slate-dim">
                  Save this date and we will write to you the moment a matching note is listed.
                  Most dates find their note within a season.
                </p>
                <button
                  type="button"
                  className="mt-7 rounded-full bg-primary px-8 py-3 text-sm font-medium text-cream transition-colors hover:bg-secondary"
                >
                  Save this date
                </button>
              </div>
            )}

            {results.dayMonth.length > 0 && (
              <div className="mt-14">
                <p className="mb-6 text-sm text-slate-dim">
                  <span className="text-slate">Same day and month,</span> a different year. The
                  near misses collectors often prefer.
                </p>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {results.dayMonth.slice(0, 6).map((match) => (
                    <NoteCard
                      key={match.entry.id}
                      entry={match.entry}
                      interpretation={match.interpretation}
                      badge="Near"
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Category rails, counted from the real catalogue */}
        <section className="mb-20">
          <SectionHeading overline="The Vault" title="Browse by character" />
          <div className="grid gap-px overflow-hidden rounded-sm border border-sand-line bg-sand-line sm:grid-cols-2 lg:grid-cols-4">
            {rails.map((rail) => (
              <div key={rail.code} className="bg-sand-raised p-5">
                <p className="font-display text-lg text-slate">{rail.label}</p>
                <p className="mt-1 font-mono text-xs text-slate-dim">
                  {rail.count} {rail.count === 1 ? 'note' : 'notes'}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Featured */}
        <section>
          <SectionHeading overline="The Floor" title="Rarest in the vault" />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((entry) => (
              <NoteCard
                key={entry.id}
                entry={entry}
                badge={`Rarity ${(entry.analysis.rarityScore * 100).toFixed(0)}`}
              />
            ))}
          </div>
        </section>
      </main>

      <SiteFooter noteCount={CATALOGUE.length} />
    </div>
  );
}
