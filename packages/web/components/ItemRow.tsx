import { publishListing, startAuction, uploadPhoto } from '@/app/actions.ts';
import { ActionForm, Field } from '@/components/Forms.tsx';
import { STATE_LABEL, rupees, type SellerListing } from '@/lib/seller-dashboard.ts';

/**
 * One of the seller's items, with everything they can do to it.
 *
 * The actions are here rather than on the listing's own page because a seller
 * working through a backlog should not have to open ten pages to add ten
 * photographs. They are collapsed behind disclosures so a long list stays
 * readable — and `<details>` rather than a script-driven panel, so it works on
 * a slow phone before anything has hydrated.
 */
export function ItemRow({
  listing,
  canPublish,
}: {
  listing: SellerListing;
  canPublish: boolean;
}) {
  const isDraft = listing.state === 'draft';
  const isAuction = listing.saleMode === 'auction';

  return (
    <li className="rounded-sm border border-sand-line bg-sand-raised p-4">
      <div className="flex flex-wrap items-center gap-4">
        {listing.imageUrl !== null ? (
          <img
            src={listing.imageUrl}
            alt={listing.title}
            className="h-16 w-24 shrink-0 rounded-sm border border-sand-line object-cover"
          />
        ) : (
          <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-sm border border-dashed border-accent-deep/50 text-center text-[10px] leading-tight text-accent-deep">
            No photo
          </div>
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
          {isAuction && (
            <span className="rounded-full border border-accent-deep/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-accent-deep">
              Auction
            </span>
          )}
          <span className="rounded-full border border-sand-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
            {STATE_LABEL[listing.state] ?? listing.state}
          </span>
          {isDraft && canPublish && (
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
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-sand-line pt-3">
        {/* Photographs. Available at any state — a live listing can always use
            a better picture. */}
        <details className="group w-full">
          <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-sand-line px-4 py-1.5 text-xs text-slate transition-colors hover:border-accent-deep">
            <span aria-hidden>＋</span>
            {listing.photoCount === 0 ? 'Add a photograph' : 'Add another photograph'}
          </summary>

          <form
            action={uploadPhoto}
            encType="multipart/form-data"
            className="mt-3 flex flex-wrap items-end gap-3 rounded-sm border border-sand-line bg-sand p-4"
          >
            <input type="hidden" name="listingId" value={listing.id} />
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                Which side
              </span>
              <select
                name="kind"
                defaultValue="obverse"
                className="rounded-sm border border-sand-line bg-sand-raised px-3 py-2 text-sm text-slate outline-none focus-visible:border-accent-deep"
              >
                <option value="obverse">Front</option>
                <option value="reverse">Back</option>
                <option value="detail">Detail</option>
                <option value="uv">Under UV</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                Image
              </span>
              <input
                type="file"
                name="file"
                required
                accept="image/jpeg,image/png,image/webp"
                className="text-sm text-slate file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:text-cream"
              />
            </label>
            <button
              type="submit"
              className="rounded-full bg-primary px-5 py-2 text-xs font-medium text-cream transition-colors hover:bg-secondary"
            >
              Upload
            </button>
            <p className="w-full text-xs text-slate-dim">
              JPEG, PNG or WebP, up to 10 MB. Photograph it flat, in daylight, with the serial
              legible.
            </p>
          </form>
        </details>

        {/* Auction. Only a draft can be converted — a live or reserved listing
            may already have a buyer part-way through. */}
        {isDraft && canPublish && (
          <details className="group w-full">
            <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-sand-line px-4 py-1.5 text-xs text-slate transition-colors hover:border-accent-deep">
              <span aria-hidden>⚖</span>
              Sell by auction instead
            </summary>

            <div className="mt-3 rounded-sm border border-sand-line bg-sand p-4">
              <p className="mb-4 text-xs leading-relaxed text-slate-dim">
                Bidders name the most they will pay and we bid for them in small steps, so a lot
                often closes below the top bidder&rsquo;s ceiling. Publishing as an auction replaces
                the fixed price — you cannot switch back once bidding starts.
              </p>
              <ActionForm action={startAuction} submitLabel="Start the auction">
                <input type="hidden" name="listingId" value={listing.id} />
                <Field
                  label="Starting price in rupees"
                  name="startingInr"
                  type="number"
                  required
                  placeholder={String(Math.max(1, Math.round((listing.priceInr ?? 1000) / 4)))}
                  hint="Low starts attract more bidders. The reserve is what protects you."
                />
                <Field
                  label="Reserve in rupees"
                  name="reserveInr"
                  type="number"
                  placeholder={listing.priceInr === null ? '5000' : String(listing.priceInr)}
                  hint="Below this it does not sell. Bidders see only whether it has been met."
                />
                <Field
                  label="Run for how many days"
                  name="days"
                  type="number"
                  defaultValue="7"
                  hint="1 to 30. A bid in the last two minutes extends the close."
                />
              </ActionForm>
            </div>
          </details>
        )}
      </div>
    </li>
  );
}
