import { auctionsEnabled } from '@rareminting/config';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { deleteListingPhoto, editListingFull, setSaleMode, uploadPhoto } from '@/app/actions.ts';
import type { FilterCategory } from '@/components/BrowseFilters.tsx';
import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { api, type ApiListing } from '@/lib/api.ts';
import { buyerMenu } from '@/lib/buyer-dashboard.ts';
import { loadSellerOrNull, sellerMenu } from '@/lib/seller-dashboard.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Edit listing', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const GRADES = ['UNC', 'AU', 'XF', 'VF', 'F', 'VG', 'G', 'POOR'] as const;

const STATES = [
  ['draft', 'Draft — nobody else can see it'],
  ['minted', 'Published — on the floor'],
  ['withdrawn', 'Unpublished — taken off the floor'],
] as const;

/**
 * One editor, for the seller who owns the listing and for staff.
 *
 * The same screen either way. An admin page that looked different from the
 * seller's would be a second thing to keep in step, and the two would drift —
 * which is the same reason the API validates both through one module.
 *
 * What differs is only what the page says about who is editing: staff acting
 * on somebody else's listing are told so plainly, because it is the sort of
 * thing that ought to feel deliberate rather than routine.
 *
 * Auction fields appear only for an auction and pricing fields only for a
 * fixed sale, so the form never asks for something that has no meaning for
 * the listing in front of it.
 */
export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;

  const user = await currentUser();
  if (user === null) redirect('/signin');
  const token = await sessionToken();

  const result = await api<{ listing: ApiListing }>(`/v1/listings/${id}`, { token });
  if (!result.ok) notFound();
  const listing = result.data.listing;

  const isAdmin = user.roles.includes('admin');
  const sellerProfile = await loadSellerOrNull();
  const isOwner =
    sellerProfile !== null &&
    listing.sellerId !== undefined &&
    // The seller dashboard carries the seller's own id on its profile.
    (await api<{ seller: { id: string } }>('/v1/sellers/me', { token }).then(
      (r) => r.ok && r.data.seller.id === listing.sellerId,
    ));

  // Staff may edit anything; a seller only their own. This mirrors the API,
  // which is what actually enforces it — the page is a courtesy, not a lock.
  if (!isAdmin && !isOwner) notFound();

  const isAuction = listing.saleMode === 'auction';
  const media = listing.media ?? [];

  const categoryResult = await api<{ categories: FilterCategory[] }>('/v1/categories', {
    revalidate: 300,
  });
  const categories = categoryResult.ok ? categoryResult.data.categories : [];
  const tops = categories.filter((c) => c.parentId === null);

  const sections =
    sellerProfile === null
      ? buyerMenu({ orders: 0, isSeller: false })
      : sellerMenu(sellerProfile.data);

  return (
    <DashboardShell
      user={user}
      eyebrow="Edit listing"
      title={listing.title}
      subtitle={`${isAuction ? 'Auction' : 'Fixed price'} · ${listing.state}`}
      sections={sections}
      current="/seller/items"
      action={{ href: `/listing/${id}`, label: 'View listing' }}
    >
      <div className="flex max-w-3xl flex-col gap-6">
        {isAdmin && !isOwner && (
          <p className="rounded-sm border border-accent-deep/50 bg-sand-raised px-5 py-4 text-sm leading-relaxed text-slate">
            This listing belongs to another member. You are editing it as staff, and every change
            is written to the audit log against your account.
          </p>
        )}

        {error !== undefined && error !== '' && (
          <p
            role="alert"
            className="rounded-sm border border-ember/50 bg-ember/10 px-5 py-4 text-sm leading-relaxed text-slate"
          >
            {error}
          </p>
        )}
        {saved !== undefined && (
          <p className="rounded-sm border border-accent-deep/40 bg-sand-raised px-5 py-4 text-sm text-slate">
            Saved.
          </p>
        )}

        {/* ---------------- basics, pricing and status ---------------- */}
        <form action={editListingFull} className="flex flex-col gap-6">
          <input type="hidden" name="listingId" value={id} />

          <Panel title="Basic information">
            <div className="flex flex-col gap-4">
              <Field label="Title" name="title" defaultValue={listing.title} required />
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                  Description
                </span>
                <textarea
                  name="description"
                  rows={8}
                  defaultValue={listing.description ?? ''}
                  placeholder="What a buyer should know: what it is, how it came to you, anything the photographs do not show."
                  className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm leading-relaxed text-slate"
                />
                <span className="text-xs text-slate-dim">
                  Shown at the foot of the listing. Where you leave it empty, the page writes its
                  own account from the serial, the grade and the dates it reads as.
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                  Category
                </span>
                <select
                  name="categoryId"
                  defaultValue={listing.categoryId ?? ''}
                  className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
                >
                  <option value="">Not filed</option>
                  {tops.map((top) => (
                    <optgroup key={top.id} label={top.name}>
                      <option value={top.id}>{top.name} — all</option>
                      {categories
                        .filter((c) => c.parentId === top.id)
                        .map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <span className="text-xs text-slate-dim">
                  Where buyers find it when they filter the floor. Pick the sub-category if one
                  fits; the top level is fine if none does.
                </span>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                    Condition
                  </span>
                  <select
                    name="grade"
                    defaultValue={listing.grade ?? ''}
                    className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
                  >
                    <option value="">Not graded</option>
                    {GRADES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                    Status
                  </span>
                  <select
                    name="state"
                    defaultValue={listing.state}
                    className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
                  >
                    {STATES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </Panel>

          <Panel title="Certification">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Grading body"
                name="certificationBody"
                placeholder="PMG, PCGS, NGC…"
                hint="Leave empty if it has not been slabbed."
              />
              <Field label="Certificate number" name="certificationNumber" />
            </div>
          </Panel>

          {!isAuction && (
            <Panel title="Pricing">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Selling price in rupees"
                  name="priceInr"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={listing.priceInr ?? ''}
                />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-dim">
                Whole rupees. A listing that is reserved for a buyer, or already sold, cannot have
                its price changed — somebody is part-way through paying the one that is on it.
              </p>
            </Panel>
          )}

          <div>
            <button
              type="submit"
              className="rounded-full bg-primary px-8 py-3 text-sm font-medium text-cream transition-colors hover:bg-secondary"
            >
              Save changes
            </button>
          </div>
        </form>

        {/* ---------------- photographs ---------------- */}
        <Panel title="Photographs">
          {media.length === 0 ? (
            <p className="text-sm text-slate-dim">
              No photographs yet. A listing without one rarely sells.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {media.map((m) => (
                <li key={m.id} className="flex flex-col gap-2">
                  <img
                    src={m.url}
                    alt={`${listing.title} — ${m.kind}`}
                    className="aspect-[3/2] w-full rounded-sm border border-sand-line object-cover"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
                      {m.kind}
                    </span>
                    <form action={deleteListingPhoto}>
                      <input type="hidden" name="listingId" value={id} />
                      <input type="hidden" name="mediaId" value={m.id} />
                      <button
                        type="submit"
                        className="text-[11px] text-slate-dim underline-offset-4 transition-colors hover:text-ember hover:underline"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Its own form: a file upload cannot ride along with the fields
              above, and a photograph should not wait on the rest being valid. */}
          <form action={uploadPhoto} className="mt-5 flex flex-wrap items-end gap-3 border-t border-sand-line pt-5">
            <input type="hidden" name="listingId" value={id} />
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Which side
              </span>
              <select
                name="kind"
                defaultValue="obverse"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              >
                <option value="obverse">Front</option>
                <option value="reverse">Back</option>
                <option value="detail">Detail</option>
                <option value="uv">Under UV</option>
              </select>
            </label>
            <input
              type="file"
              name="file"
              accept="image/jpeg,image/png,image/webp"
              required
              className="text-xs text-slate-dim file:mr-3 file:rounded-full file:border file:border-sand-line file:bg-sand-raised file:px-3 file:py-1.5 file:text-xs file:text-slate"
            />
            <button
              type="submit"
              className="rounded-full border border-accent-deep px-6 py-2 text-sm text-accent-deep transition-colors hover:bg-accent-deep hover:text-cream"
            >
              Add photograph
            </button>
          </form>
        </Panel>

        {/* ---------------- sale type ---------------- */}
        <Panel title="Sale type">
          <p className="text-sm leading-relaxed text-slate-dim">
            This listing is {isAuction ? 'an auction' : 'a fixed-price sale'}.
          </p>

          {/* Paused. A listing that is already an auction can still be turned
              back into a fixed-price sale — that is the direction out, and
              blocking it would strand the four listings still in auction mode
              with no way to sell them. What is refused is the way in. */}
          {!auctionsEnabled() && !isAuction && (
            <p className="mt-3 rounded-sm border border-sand-line bg-sand px-4 py-3 text-sm leading-relaxed text-slate-dim">
              Auctions are paused, so a listing cannot be converted into one at the moment.
              Everything already under the hammer is untouched.
            </p>
          )}

          {(auctionsEnabled() || isAuction) && (
          <form action={setSaleMode} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="listingId" value={id} />
            <input type="hidden" name="saleMode" value={isAuction ? 'fixed' : 'auction'} />

            {isAuction ? (
              <>
                <Field
                  label="Price in rupees once it is a fixed sale"
                  name="priceInr"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={listing.priceInr ?? ''}
                />
                <p className="text-xs leading-relaxed text-slate-dim">
                  Turning this back into a fixed-price sale ends the auction. Bids are a
                  commitment by the people who made them, so this is refused outright while an
                  auction is live and has bids on it. The auction settings are kept either way,
                  so nothing is lost if you run one again.
                </p>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-slate-dim">
                Making this an auction changes how it sells: bidders commit rather than buy, and
                the price is settled when the auction closes. You will set the starting price and
                the dates on the next screen. Anyone who has it saved keeps it saved.
              </p>
            )}

            <button
              type="submit"
              className="self-start rounded-full border border-sand-line px-6 py-2.5 text-sm text-slate transition-colors hover:border-accent-deep"
            >
              {isAuction ? 'Convert to a fixed-price sale' : 'Convert to an auction'}
            </button>
          </form>
          )}

          {isAuction && (
            <p className="mt-4 border-t border-sand-line pt-4 text-sm text-slate-dim">
              Starting price, bid increment and the opening and closing times are set on the{' '}
              <a
                href="/seller/auctions"
                className="text-accent-deep underline underline-offset-4"
              >
                auctions page
              </a>
              .
            </p>
          )}
        </Panel>
      </div>
    </DashboardShell>
  );
}

function Field({
  label,
  name,
  hint,
  ...rest
}: {
  label: string;
  name: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
        {label}
      </span>
      <input
        name={name}
        maxLength={200}
        className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate outline-none focus-visible:border-accent-deep"
        {...rest}
      />
      {hint !== undefined && <span className="text-xs text-slate-dim">{hint}</span>}
    </label>
  );
}
