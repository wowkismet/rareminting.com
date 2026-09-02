import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createCollectible, createListing, registerSeller } from '@/app/actions.ts';
import { ActionForm, Field, Select } from '@/components/Forms.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { DashboardShell } from '@/components/DashboardShell.tsx';
import { loadSellerOrNull, sellerMenu } from '@/lib/seller-dashboard.ts';
import { currentSeller, currentUser } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Sell a note' };
export const dynamic = 'force-dynamic';

const DENOMINATIONS = [10, 20, 50, 100, 200, 500, 2000];

const ITEM_KINDS = [
  { value: 'coin', label: 'Coin' },
  { value: 'stamp', label: 'Stamp' },
  { value: 'bond', label: 'Bond' },
  { value: 'share_certificate', label: 'Share certificate' },
  { value: 'ephemera', label: 'Ephemera' },
  { value: 'other', label: 'Something else' },
] as const;

const GRADES = [
  { value: 'UNC', label: 'UNC — uncirculated' },
  { value: 'AU', label: 'AU — about uncirculated' },
  { value: 'XF', label: 'XF — extremely fine' },
  { value: 'VF', label: 'VF — very fine' },
  { value: 'F', label: 'F — fine' },
  { value: 'VG', label: 'VG — very good' },
  { value: 'G', label: 'G — good' },
] as const;

/**
 * The photograph, taken at the moment of listing.
 *
 * Optional, because a seller may be at their desk without the note in front of
 * them — but offered here because the alternative is listing an item and only
 * discovering later that nobody can see it.
 */
/**
 * How the item is to be sold.
 *
 * Both sets of fields are on the page at once rather than swapped by script,
 * so the form works before hydration and on a phone with the connection cut.
 * The hints say which fields apply to which choice; the server ignores the
 * auction fields entirely when a fixed price is chosen.
 */
function SaleModeFields({ suggestedStart }: { suggestedStart: string }) {
  return (
    <>
      <Select
        label="How to sell it"
        name="saleMode"
        defaultValue="fixed"
        options={[
          { value: 'fixed', label: 'Fixed price — sell at your asking price' },
          { value: 'auction', label: 'Auction — let bidders decide' },
        ]}
      />

      <div className="rounded-sm border border-sand-line bg-sand p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent-deep">
          Auction only
        </p>
        <p className="mt-2 mb-5 text-xs leading-relaxed text-slate-dim">
          Ignored if you chose a fixed price. Bidders name the most they will pay and we bid for
          them in small steps, so a lot often closes below the top bidder&rsquo;s ceiling — a low
          start attracts more of them, and the reserve is what protects you.
        </p>

        <div className="flex flex-col gap-5">
          <Field
            label="Base price — where bidding opens"
            name="startingInr"
            type="number"
            placeholder={suggestedStart}
            hint="Required for an auction."
          />
          <Field
            label="Reserve in rupees"
            name="reserveInr"
            type="number"
            placeholder="Leave blank for no reserve"
            hint="Below this it does not sell. Bidders are told only whether it has been met, never the figure."
          />
          <Field
            label="Run for how many days"
            name="days"
            type="number"
            defaultValue="7"
            hint="1 to 30. A bid in the final two minutes extends the close."
          />
        </div>
      </div>
    </>
  );
}

function PhotoField() {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
        Photograph<span className="ml-2 normal-case tracking-normal">optional</span>
      </span>
      <input
        type="file"
        name="photo"
        accept="image/jpeg,image/png,image/webp"
        className="text-sm text-slate file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:text-cream"
      />
      <span className="text-xs text-slate-dim">
        Buyers decide on the picture. Photograph it flat, in daylight, with the serial legible. You
        can add more from your dashboard afterwards.
      </span>
    </label>
  );
}

export default async function SellPage() {
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const seller = await currentSeller();

  // A registered seller keeps their dashboard furniture while listing — losing
  // the menu the moment you start adding an item makes listing feel like a
  // detour off the site rather than part of it. Somebody who has not
  // registered yet has no dashboard to show, so they get the plain page.
  const dash = seller === null ? null : await loadSellerOrNull();

  const body = (
    <>
      <div className="flex flex-col gap-8">
        {seller === null ? (
          <>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
                The Mint
              </p>
              <h1 className="mt-2 font-display text-3xl text-slate">Register as a seller</h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-dim">
                Six details and you are done. An admin checks them, and once you are approved you
                can list as many notes, coins and collectibles as you like. You can start preparing
                listings straight away — they go live the moment you are approved.
              </p>
            </div>

            <div className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
              <p>
                Your email is already on your account. We need your PAN and Aadhaar because the law
                requires us to know who is selling before we can pay anyone out.
              </p>
              <p className="mt-2">
                We do not keep either number. They are converted to a one-way fingerprint the moment
                they arrive; all that remains on file is the last four digits, so support can tell
                which card you are holding. Nobody at {"Rare Minting"} — including an admin — can
                read them back.
              </p>
            </div>

            <ActionForm action={registerSeller} submitLabel="Register as a seller">
              <Field
                label="Full name, as printed on your PAN"
                name="fullName"
                required
                placeholder="Kavya Kapoor"
                autoComplete="name"
              />
              <Field
                label="Mobile number"
                name="mobile"
                type="tel"
                required
                placeholder="98123 45678"
                autoComplete="tel"
                hint="Indian mobile numbers only. We use it for order and dispatch updates."
              />
              <Field
                label="PAN"
                name="pan"
                required
                placeholder="ABCPE1234F"
                hint="Ten characters, as printed on the card."
              />
              <Field
                label="Aadhaar number"
                name="aadhaar"
                required
                placeholder="XXXX XXXX XXXX"
                hint="Twelve digits. Checked for typos before it is sent."
              />
              <Field
                label="One-time code"
                name="otp"
                placeholder="6-digit code"
                hint="Leave blank if you have not been sent one — mobile verification is not switched on yet."
              />
            </ActionForm>
          </>
        ) : (
          <>
            {seller.approved ? (
              <div className="rounded-sm border border-accent-deep/50 bg-accent-deep/10 p-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent-deep">
                  Approved
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-dim">
                  You are approved to sell. List as many notes, coins and collectibles as you like —
                  there is no cap.
                </p>
              </div>
            ) : (
              <div className="rounded-sm border border-accent-deep/40 bg-sand-raised p-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent-deep">
                  {seller.kycState === 'rejected' ? 'Not approved' : 'Awaiting approval'}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-dim">
                  {seller.kycState === 'rejected'
                    ? 'Your seller account was not approved. Contact us and we will tell you what to fix.'
                    : 'An admin is checking your details. Prepare your listings now — you can publish them the moment you are approved, and there is no limit on how many.'}
                </p>
              </div>
            )}

            <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
              <p className="text-sm leading-relaxed text-slate-dim">
                Enter the serial exactly as printed, including the prefix and any star. We read the
                dates it can mean and every fancy-number pattern it carries — that is what makes it
                findable by the buyer looking for their date.
              </p>
            </div>

            <ActionForm action={createListing} submitLabel="Create listing" encType="multipart/form-data">
              <Field
                label="Serial number"
                name="serial"
                required
                placeholder="9AB* 150892"
                hint="Prefix, star if present, then the digits. Leading zeros matter."
              />
              <Select
                label="Denomination"
                name="denomination"
                defaultValue="100"
                options={DENOMINATIONS.map((d) => ({ value: String(d), label: `₹${d}` }))}
              />
              <Field
                label="Series"
                name="series"
                defaultValue="Mahatma Gandhi New Series"
                placeholder="Mahatma Gandhi New Series"
              />
              <Select label="Condition" name="grade" options={GRADES} defaultValue="UNC" />
              <Field
                label="Price in rupees"
                name="priceInr"
                type="number"
                required
                placeholder="4500"
              />

              <SaleModeFields suggestedStart="1000" />
              <PhotoField />
              <Field label="Anything else worth knowing" name="description" />
            </ActionForm>

            {/* Coins and everything else. Kept as a separate form rather than a
                toggle, because the two have almost no fields in common and a
                form that rearranged itself would be worse than two clear ones. */}
            <div id="collectible" className="mt-4 scroll-mt-6 border-t border-sand-line pt-10">
              <h2 className="font-display text-2xl text-slate">
                Or list a coin or other collectible
              </h2>
              <p className="mt-2 mb-6 text-sm leading-relaxed text-slate-dim">
                A coin has no serial number, so there is nothing to read for dates — only a title
                and a price are required. Everything else describes the piece, and you can leave
                out anything you do not know.
              </p>

              <ActionForm action={createCollectible} submitLabel="Create listing" encType="multipart/form-data">
                <Select label="What is it" name="kind" options={ITEM_KINDS} defaultValue="coin" />
                <Field
                  label="Title"
                  name="title"
                  required
                  placeholder="1947 One Rupee"
                  hint="What a buyer would search for."
                />
                <Field
                  label="Price in rupees"
                  name="priceInr"
                  type="number"
                  required
                  placeholder="1200"
                />
                <Field
                  label="Year of issue"
                  name="yearOfIssue"
                  type="number"
                  placeholder="1947"
                  hint="The year it was struck or issued."
                />
                <Field
                  label="Face value in rupees"
                  name="denomination"
                  type="number"
                  placeholder="1"
                  hint="Leave blank for a medal or token with no face value."
                />
                <Field label="Metal" name="metal" placeholder="Nickel, silver, copper…" />
                <Field
                  label="Mint mark"
                  name="mintMark"
                  placeholder="B, C, ◆, ★"
                  hint="Bombay a diamond, Calcutta none or a dot, Hyderabad a star."
                />
                <Field
                  label="Weight in grams"
                  name="weightGrams"
                  type="number"
                  placeholder="11.66"
                />
                <Field
                  label="Catalogue reference"
                  name="catalogueRef"
                  placeholder="KM#559"
                  hint="A standard reference lets a buyer look the type up independently."
                />
                <Select label="Condition" name="grade" options={GRADES} defaultValue="XF" />
                <SaleModeFields suggestedStart="1000" />
              <PhotoField />
              <Field label="Anything else worth knowing" name="description" />
              </ActionForm>
            </div>
          </>
        )}
      </div>
    </>
  );

  // Registered: the same shell, the same left menu, as every other seller page.
  if (dash !== null) {
    return (
      <DashboardShell
        user={dash.user}
        eyebrow="The Mint"
        title="List an item"
        subtitle={`Selling as ${dash.data.seller.displayName}`}
        sections={sellerMenu(dash.data)}
        current="/sell"
      >
        <div className="max-w-2xl">{body}</div>
      </DashboardShell>
    );
  }

  return (
    <div>
      <SiteHeader user={user} compact />
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-14">{body}</main>
      <SiteFooter />
    </div>
  );
}
