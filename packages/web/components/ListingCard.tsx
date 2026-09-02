import type { ApiListing } from '@/lib/api.ts';

/**
 * A listing, as a card.
 *
 * Always a link: every card the site shows is something a visitor can actually
 * open and buy. Shared by the homepage and the browse grid so a note looks the
 * same wherever it is met.
 */
export function ListingCard({ listing, badge }: { listing: ApiListing; badge?: string }) {
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
          Matches {listing.match.iso ?? `${listing.match.day}/${listing.match.month}`}
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
}
