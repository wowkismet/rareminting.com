import { publishListing } from '@/app/actions.ts';
import { STATE_LABEL, rupees, type SellerListing } from '@/lib/seller-dashboard.ts';

/**
 * One of the seller's items, as a row.
 *
 * Shared between the overview, the item list and the photographs page so an
 * item looks the same wherever a seller meets it.
 */
export function ItemRow({
  listing,
  canPublish,
}: {
  listing: SellerListing;
  canPublish: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-sm border border-sand-line bg-sand-raised p-4">
      {listing.imageUrl !== null ? (
        <img
          src={listing.imageUrl}
          alt={listing.title}
          className="h-16 w-24 shrink-0 rounded-sm border border-sand-line object-cover"
        />
      ) : (
        <a
          href={`/listing/${listing.id}`}
          className="flex h-16 w-24 shrink-0 items-center justify-center rounded-sm border border-dashed border-accent-deep/50 text-center text-[10px] leading-tight text-accent-deep transition-colors hover:bg-accent-deep/10"
        >
          Add a
          <br />
          photo
        </a>
      )}

      <div className="min-w-0 flex-1">
        <a
          href={`/listing/${listing.id}`}
          className="font-mono text-sm text-slate underline-offset-4 hover:underline"
        >
          {listing.serialDigits ?? listing.title}
        </a>
        <p className="mt-1 text-xs text-slate-dim">
          {listing.denomination !== null && `₹${listing.denomination} · `}
          {listing.grade ?? 'ungraded'}
          {listing.priceInr !== null && ` · ${rupees(listing.priceInr)}`}
          {' · '}
          {listing.views} view{listing.views === 1 ? '' : 's'}
          {' · '}
          {listing.photoCount} photo{listing.photoCount === 1 ? '' : 's'}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className="rounded-full border border-sand-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
          {STATE_LABEL[listing.state] ?? listing.state}
        </span>
        {listing.state === 'draft' && canPublish && (
          <form action={publishListing}>
            <input type="hidden" name="id" value={listing.id} />
            <button
              type="submit"
              className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-secondary"
            >
              Publish
            </button>
          </form>
        )}
      </div>
    </li>
  );
}
