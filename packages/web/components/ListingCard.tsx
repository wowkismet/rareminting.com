import type { ApiListing } from '@/lib/api.ts';
import { formatDayFirst, formatDayMonth } from '@/lib/search.ts';
import { SaveHeart } from '@/components/SaveHeart.tsx';

/**
 * A listing, as a card.
 *
 * Always a link: every card the site shows is something a visitor can actually
 * open and buy. Shared by the homepage and the browse grid so a note looks the
 * same wherever it is met.
 *
 * The heart, when shown, is a sibling of that link rather than inside it — a
 * button nested in an anchor is invalid and browsers disagree about which one
 * a click belongs to.
 */
export function ListingCard({
  listing,
  badge,
  saved,
  savePath,
}: {
  listing: ApiListing;
  badge?: string;
  /** Whether this visitor has already saved it. Omit to hide the heart. */
  saved?: boolean | undefined;
  /** Path to redraw after saving. Required for the heart to appear. */
  savePath?: string | undefined;
}) {
  const note = listing.note;
  const showHeart = saved !== undefined && savePath !== undefined;

  const card = (
    <a
      href={`/listing/${listing.id}`}
      className="flex h-full flex-col gap-3 rounded-sm border border-sand-line bg-sand-raised p-5 transition-colors hover:border-accent-deep/60"
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

      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-sand-line px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
          {listing.saleMode === 'auction' ? 'Auction' : 'Fixed price'}
        </span>
        {badge !== undefined && (
          <span className="rounded-full border border-accent-deep/40 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent-deep">
            {badge}
          </span>
        )}
      </div>

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

      {listing.match !== undefined && (
        <p className="font-mono text-xs text-accent-deep">
          Matches{' '}
          {listing.match.iso === null || listing.match.iso === undefined
            ? formatDayMonth(listing.match.day, listing.match.month)
            : formatDayFirst(listing.match.iso)}
        </p>
      )}

      <p className="mt-auto flex items-baseline justify-between gap-3">
        <span className="font-display text-xl text-slate">
          {listing.priceInr === null ? '—' : `₹${listing.priceInr.toLocaleString('en-IN')}`}
        </span>
        <span className="text-xs text-slate-dim">
          {note !== undefined && `₹${note.denomination} · `}
          {listing.grade ?? 'ungraded'}
        </span>
      </p>
    </a>
  );

  if (!showHeart) return card;

  return (
    <div className="relative h-full">
      {card}
      <SaveHeart listingId={listing.id} saved={saved} from={savePath} />
    </div>
  );
}
