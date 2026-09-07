import { addToCart, buyNow } from '@/app/actions.ts';
import type { ApiListing } from '@/lib/api.ts';
import { formatDayFirst, formatDayMonth } from '@/lib/search.ts';
import { SaveHeart } from '@/components/SaveHeart.tsx';

/**
 * A listing, as a card.
 *
 * Shared by the homepage and the browse grid so a note looks the same wherever
 * it is met, and so a buyer can act on one without opening it first.
 *
 * The link covers the card's content; the heart and the two buttons are
 * siblings of it rather than children. A button nested inside an anchor is
 * invalid, and browsers disagree about which of the two a click belongs to.
 */
export function ListingCard({
  listing,
  badge,
  saved,
  fromPath = '/',
}: {
  listing: ApiListing;
  badge?: string;
  /** Whether this visitor has already saved it. Omit to hide the heart. */
  saved?: boolean | undefined;
  /** The page these buttons sit on, so it redraws after an action. */
  fromPath?: string;
}) {
  const note = listing.note;
  const isAuction = listing.saleMode === 'auction';

  // Only a live listing can be acted on. A reserved or sold one keeps its card
  // — it is still worth looking at — but says so instead of offering a button
  // that would fail at the till.
  const buyable = listing.state === 'minted';

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-sm border border-sand-line bg-sand-raised transition-colors hover:border-accent-deep/60">
      <a href={`/listing/${listing.id}`} className="flex flex-1 flex-col gap-2 p-4">
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

        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-sand-line px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
            {isAuction ? 'Auction' : 'Fixed price'}
          </span>
          {badge !== undefined && (
            <span className="rounded-full border border-accent-deep/40 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent-deep">
              {badge}
            </span>
          )}
        </div>

        {note !== undefined ? (
          // The serial keeps its letter-spacing even at this size: it is a
          // number people read digit by digit, looking for their own date in
          // it, and tightening it up is what makes six digits misread as five.
          <p className="font-mono text-sm tracking-[0.1em] tabular-nums text-slate">
            {note.prefix !== null && (
              <span className="text-slate-dim">
                {note.prefix}
                {note.isStar && <span className="text-ember">*</span>}{' '}
              </span>
            )}
            {note.serialDigits}
          </p>
        ) : (
          <p className="font-display text-sm text-slate">{listing.title}</p>
        )}

        {listing.match !== undefined && (
          <p className="font-mono text-xs text-accent-deep">
            Matches{' '}
            {listing.match.iso === null || listing.match.iso === undefined
              ? formatDayMonth(listing.match.day, listing.match.month)
              : formatDayFirst(listing.match.iso)}
          </p>
        )}

        <p className="mt-auto flex items-baseline justify-between gap-2">
          <span className="font-display text-base text-slate">
            {listing.priceInr === null ? '—' : `₹${listing.priceInr.toLocaleString('en-IN')}`}
          </span>
          <span className="text-[10px] text-slate-dim">
            {note !== undefined && `₹${note.denomination} · `}
            {listing.grade ?? 'ungraded'}
          </span>
        </p>
      </a>

      <div className="border-t border-sand-line px-4 py-2.5">
        {!buyable ? (
          <p className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
            {listing.state === 'struck' ? 'Sold' : 'Not available'}
          </p>
        ) : isAuction ? (
          // An auction is bid on, not bought. The bidding lives on the listing
          // itself, so this opens it rather than pretending to place a bid
          // from a grid.
          <a
            href={`/listing/${listing.id}`}
            className="block whitespace-nowrap rounded-full bg-primary px-2.5 py-1.5 text-center text-xs font-medium text-cream transition-colors hover:bg-secondary"
          >
            Place a bid
          </a>
        ) : (
          <div className="flex gap-2">
            <form action={addToCart} className="flex-1">
              <input type="hidden" name="listingId" value={listing.id} />
              <input type="hidden" name="from" value={fromPath} />
              <button
                type="submit"
                className="w-full whitespace-nowrap rounded-full bg-accent px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-accent-bright"
              >
                Add to cart
              </button>
            </form>
            <form action={buyNow} className="flex-1">
              <input type="hidden" name="listingId" value={listing.id} />
              <button
                type="submit"
                className="w-full whitespace-nowrap rounded-full bg-primary px-2.5 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-secondary"
              >
                Buy now
              </button>
            </form>
          </div>
        )}
      </div>

      {saved !== undefined && (
        <SaveHeart listingId={listing.id} saved={saved} from={fromPath} />
      )}
    </div>
  );
}
