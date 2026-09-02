import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createListing, registerSeller } from '@/app/actions.ts';
import { ActionForm, Field, Select } from '@/components/Forms.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { currentSeller, currentUser } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Sell a note' };
export const dynamic = 'force-dynamic';

const DENOMINATIONS = [10, 20, 50, 100, 200, 500, 2000];

const GRADES = [
  { value: 'UNC', label: 'UNC — uncirculated' },
  { value: 'AU', label: 'AU — about uncirculated' },
  { value: 'XF', label: 'XF — extremely fine' },
  { value: 'VF', label: 'VF — very fine' },
  { value: 'F', label: 'F — fine' },
  { value: 'VG', label: 'VG — very good' },
  { value: 'G', label: 'G — good' },
] as const;

export default async function SellPage() {
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const seller = await currentSeller();

  return (
    <div>
      <SiteHeader user={user} compact />

      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-14">
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
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
                  The Mint
                </p>
                <h1 className="mt-2 font-display text-3xl text-slate">List a note</h1>
              </div>
              <p className="text-sm text-slate-dim">
                Selling as <span className="text-slate">{seller.displayName}</span>
              </p>
            </div>

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

            <ActionForm action={createListing} submitLabel="Create listing">
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
              <Field label="Anything else worth knowing" name="description" />
            </ActionForm>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
