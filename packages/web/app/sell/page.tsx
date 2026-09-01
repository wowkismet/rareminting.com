import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createListing, registerSeller } from '@/app/actions.ts';
import { ActionForm, Field, Select } from '@/components/Forms.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { currentSeller, currentUser } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Sell a note' };
export const dynamic = 'force-dynamic';

const SELLER_KINDS = [
  { value: 'individual', label: 'Individual collector' },
  { value: 'sole_proprietor', label: 'Sole proprietor' },
  { value: 'company', label: 'Company' },
  { value: 'registered_dealer', label: 'Registered dealer' },
] as const;

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
                Tell us who buyers are dealing with. You can list notes straight away; identity
                verification is a separate step before your first payout.
              </p>
            </div>

            <ActionForm action={registerSeller} submitLabel="Register as a seller">
              <Field
                label="Name buyers will see"
                name="displayName"
                required
                placeholder="Kapoor Numismatics"
              />
              <Select label="You are" name="kind" options={SELLER_KINDS} defaultValue="individual" />
              <Field
                label="Registered legal name"
                name="legalName"
                placeholder="Only if different from the above"
              />
              <Field label="GSTIN" name="gstin" placeholder="27AACCJ2555L1ZC" />
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
