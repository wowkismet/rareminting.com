import { CATALOGUE, tagCounts, topByRarity } from '@/lib/catalogue.ts';
import { SUGGESTED_DATES, formatLongDate, parseIsoDate, search } from '@/lib/search.ts';
import { NoteCard } from '@/components/NoteCard.tsx';

export const dynamic = 'force-dynamic';

function Wordmark() {
  return (
    <div className="inline-block text-center">
      <div className="rule-hairline w-full" />
      <h1 className="px-2 py-2 font-display text-2xl tracking-[0.42em] text-parchment sm:text-3xl">
        RARE MINTING
      </h1>
      <div className="rule-hairline w-full" />
    </div>
  );
}

function SectionHeading({ overline, title }: { overline: string; title: string }) {
  return (
    <div className="mb-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-brass">{overline}</p>
      <h2 className="mt-2 text-2xl text-parchment sm:text-3xl">{title}</h2>
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
    <div className="mx-auto max-w-6xl px-5 pb-24">
      <header className="flex flex-col items-center gap-3 py-10">
        <Wordmark />
        <p className="font-display text-sm italic text-parchment-dim">
          Where numbers become heirlooms.
        </p>
      </header>

      {/* Hero — Find My Date */}
      <section className="guilloche border border-vault-line bg-vault px-6 py-12 text-center sm:px-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-brass">The Archive</p>
        <h2 className="mx-auto mt-4 max-w-2xl text-3xl leading-snug sm:text-4xl">
          Find the note that matches your date.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm text-parchment-dim">
          A birthday. An anniversary. The day everything changed. Somewhere there is a banknote
          numbered exactly that.
        </p>

        <form method="GET" className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <label htmlFor="date" className="sr-only">
            Your date
          </label>
          <input
            id="date"
            type="date"
            name="date"
            defaultValue={target?.iso ?? ''}
            className="border border-vault-line bg-ink px-4 py-3 font-mono text-parchment outline-none focus-visible:border-brass focus-visible:ring-1 focus-visible:ring-brass"
          />
          <button
            type="submit"
            className="border border-brass bg-brass/10 px-6 py-3 font-mono text-xs uppercase tracking-[0.25em] text-brass-bright transition-colors hover:bg-brass hover:text-ink focus-visible:bg-brass focus-visible:text-ink"
          >
            Search the vault
          </button>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="text-parchment-dim">Try:</span>
          {SUGGESTED_DATES.map((suggestion) => (
            <a
              key={suggestion.iso}
              href={`/?date=${suggestion.iso}`}
              className="border border-vault-line px-3 py-1 font-mono text-[11px] text-parchment-dim transition-colors hover:border-brass hover:text-brass-bright"
            >
              {suggestion.label}
            </a>
          ))}
        </div>
      </section>

      {/* Results */}
      {results !== null && (
        <section className="mt-16">
          <SectionHeading
            overline={(() => {
              const total = results.exact.length + results.dayMonth.length;
              return `${total} ${total === 1 ? 'match' : 'matches'} in ${CATALOGUE.length} notes`;
            })()}
            title={formatLongDate(results.iso)}
          />

          {results.exact.length > 0 ? (
            <>
              <p className="mb-5 text-sm text-parchment-dim">
                <span className="text-brass-bright">Exact matches.</span> The serial reads as your
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
            <div className="border border-brass/40 bg-vault p-8 text-center">
              <p className="font-display text-xl text-parchment">
                Nothing in the vault reads as {formatLongDate(results.iso)} — yet.
              </p>
              <p className="mx-auto mt-3 max-w-md text-sm text-parchment-dim">
                Save this date and we will write to you the moment a matching note is listed.
                Most dates find their note within a season.
              </p>
              <button
                type="button"
                className="mt-6 border border-brass px-6 py-3 font-mono text-xs uppercase tracking-[0.25em] text-brass-bright transition-colors hover:bg-brass hover:text-ink"
              >
                Save this date
              </button>
            </div>
          )}

          {results.dayMonth.length > 0 && (
            <div className="mt-12">
              <p className="mb-5 text-sm text-parchment-dim">
                <span className="text-parchment">Same day and month,</span> a different year — the
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
      <section className="mt-20">
        <SectionHeading overline="The Vault" title="Browse by character" />
        <div className="grid gap-px border border-vault-line bg-vault-line sm:grid-cols-2 lg:grid-cols-4">
          {rails.map((rail) => (
            <div key={rail.code} className="bg-vault p-5">
              <p className="font-display text-lg text-parchment">{rail.label}</p>
              <p className="mt-1 font-mono text-xs text-parchment-dim">
                {rail.count} {rail.count === 1 ? 'note' : 'notes'}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Featured */}
      <section className="mt-20">
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

      <footer className="mt-24 pt-8 rule-hairline">
        <p className="max-w-3xl text-xs leading-relaxed text-parchment-dim">
          Rare Minting is an independent collectibles marketplace. It is not affiliated with,
          endorsed by, or licensed by the Reserve Bank of India, the India Government Mint, or any
          government body. Notes are offered as numismatic collectibles at a collector&rsquo;s
          premium, not as currency exchange.
        </p>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-parchment-dim">
          www.rareminting.com · {CATALOGUE.length} notes · seed catalogue · prototype
        </p>
      </footer>
    </div>
  );
}
