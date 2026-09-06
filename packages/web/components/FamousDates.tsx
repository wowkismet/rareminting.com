import { formatDayFirst } from '@/lib/search.ts';

/**
 * A band of dates worth searching for, dropped in among the listings.
 *
 * Every date here searches the same way a buyer's own does: the engine
 * returns notes whose serial reads as that exact date, and notes reading the
 * same day and month in any other year. So a link to 15-08-1947 finds both
 * the note that spells Independence and every note that spells the fifteenth
 * of August.
 *
 * Deliberately not here: birthdays of living public figures. Using a name
 * like that to sell something is what personality-rights law in India covers,
 * and the Delhi High Court has granted injunctions on exactly that — to
 * Amitabh Bachchan among others. The dates below are public events, which
 * carry no such claim and, for a marketplace in banknotes, are the better
 * hook anyway: the day the Reserve Bank opened means more to a collector than
 * an actor's birthday.
 */

interface Moment {
  readonly icon: string;
  readonly label: string;
  readonly iso: string;
  readonly note: string;
}

const MONEY: readonly Moment[] = [
  { icon: '🏛️', label: 'The Reserve Bank opens', iso: '1935-04-01', note: 'India’s first central bank' },
  { icon: '🪙', label: 'Decimal coinage', iso: '1957-04-01', note: 'The naya paisa arrives' },
  { icon: '🏦', label: 'Banks nationalised', iso: '1969-07-19', note: 'Fourteen banks, overnight' },
  { icon: '💸', label: 'Demonetisation', iso: '2016-11-08', note: '₹500 and ₹1000 withdrawn' },
];

const NATIONAL: readonly Moment[] = [
  { icon: '🇮🇳', label: 'Independence Day', iso: '1947-08-15', note: 'The first midnight' },
  { icon: '🎉', label: 'Republic Day', iso: '1950-01-26', note: 'The Constitution takes effect' },
  { icon: '🕊️', label: 'Gandhi Jayanti', iso: '1869-10-02', note: 'Born at Porbandar' },
  { icon: '🧒', label: 'Children’s Day', iso: '1889-11-14', note: 'Nehru’s birthday' },
];

function Group({ title, moments }: { title: string; moments: readonly Moment[] }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream-dim">{title}</p>
      <ul className="mt-3 flex flex-col gap-1">
        {moments.map((m) => (
          <li key={m.iso}>
            <a
              href={`/?date=${m.iso}`}
              className="group flex items-center gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-cream/10"
            >
              <span aria-hidden className="text-lg">
                {m.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-cream">{m.label}</span>
                <span className="block font-mono text-[10px] tabular-nums text-cream-dim">
                  {formatDayFirst(m.iso)} · {m.note}
                </span>
              </span>
              <span
                aria-hidden
                className="shrink-0 text-accent opacity-0 transition-opacity group-hover:opacity-100"
              >
                →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FamousDates() {
  return (
    <section
      aria-labelledby="famous-dates"
      className="guilloche overflow-hidden rounded-sm border border-line bg-primary p-6 sm:p-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
            Find a note that matches a moment
          </p>
          <h2 id="famous-dates" className="mt-2 font-display text-2xl text-cream sm:text-3xl">
            Some dates are worth more than the note
          </h2>
        </div>
        <a
          href="#date"
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-bright"
        >
          Search your own date
        </a>
      </div>

      <div className="mt-7 grid gap-8 sm:grid-cols-2">
        <Group title="Moments in Indian money" moments={MONEY} />
        <Group title="National days" moments={NATIONAL} />
      </div>

      <p className="mt-6 border-t border-line/60 pt-4 text-xs leading-relaxed text-cream-dim">
        Each of these searches the serials for that exact date, and for the same day and month in
        any other year. A note does not have to be from 1947 to read as the fifteenth of August.
      </p>
    </section>
  );
}
