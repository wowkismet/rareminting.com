/**
 * The filter rail, down the left of the floor.
 *
 * A plain GET form, so every filtered view has its own URL: a buyer can
 * bookmark "coins under five thousand", send it to someone, or use the back
 * button and land where they expect. That is worth more here than the
 * smoothness of filtering without a reload.
 *
 * Whatever else is already narrowing the floor — a date, a collection, a
 * search term — rides along as a hidden field. Without that, choosing a price
 * would silently throw away the search that got the buyer here.
 */

const KINDS = [
  ['', 'Everything'],
  ['banknote', 'Rare notes'],
  ['coin', 'Rare coins'],
  ['jewellery', 'Antique jewellery'],
  ['precious_stone', 'Precious stones'],
  ['antique', 'Antiques'],
  ['stamp', 'Stamps'],
  ['other', 'Collectibles'],
] as const;

/** Round numbers a buyer actually thinks in, not an even split of the range. */
const PRICE_BANDS = [
  ['', '', 'Any price'],
  ['', '2000', 'Under ₹2,000'],
  ['2000', '10000', '₹2,000 – ₹10,000'],
  ['10000', '50000', '₹10,000 – ₹50,000'],
  ['50000', '', 'Over ₹50,000'],
] as const;

export function BrowseFilters({
  kind,
  minPrice,
  maxPrice,
  date,
  pattern,
  q,
}: {
  kind: string;
  minPrice: string;
  maxPrice: string;
  date?: string | undefined;
  pattern?: string | undefined;
  q?: string | undefined;
}) {
  const active = kind !== '' || minPrice !== '' || maxPrice !== '';

  return (
    <form
      method="GET"
      action="/browse"
      className="flex flex-col gap-6 rounded-sm border border-sand-line bg-sand-raised p-5"
    >
      {/* Carried through so filtering does not discard the search that got
          the buyer here. */}
      {date !== undefined && <input type="hidden" name="date" value={date} />}
      {pattern !== undefined && <input type="hidden" name="pattern" value={pattern} />}
      {q !== undefined && q !== '' && <input type="hidden" name="q" value={q} />}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
          Category
        </legend>
        {KINDS.map(([value, label]) => (
          <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-slate">
            <input
              type="radio"
              name="kind"
              value={value}
              defaultChecked={kind === value}
              className="accent-accent-deep"
            />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2 border-t border-sand-line pt-5">
        <legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
          Price
        </legend>
        {/* Bands rather than two number boxes. A pair of free inputs sitting
            beside these would need a rule for which of the two wins when they
            disagree, and every such rule surprises somebody; a single set of
            radios has one obvious meaning and each is a URL worth keeping. */}
        {PRICE_BANDS.map(([lo, hi, label]) => (
          <label key={label} className="flex cursor-pointer items-center gap-2 text-sm text-slate">
            <input
              type="radio"
              name="price"
              value={lo === '' && hi === '' ? '' : `${lo}-${hi}`}
              defaultChecked={minPrice === lo && maxPrice === hi}
              className="accent-accent-deep"
            />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2 border-t border-sand-line pt-5">
        <button
          type="submit"
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
        >
          Apply filters
        </button>
        {active && (
          <a
            href="/browse"
            className="text-center text-xs text-slate-dim underline underline-offset-4 hover:text-slate"
          >
            Clear all
          </a>
        )}
      </div>
    </form>
  );
}
