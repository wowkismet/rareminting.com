import type { Metadata } from 'next';

import { COMPANY, formattedAddress } from '@rareminting/config';

import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { currentUser } from '@/lib/session.ts';

export const metadata: Metadata = {
  title: 'About us',
  description:
    'Rare Minting is a marketplace for banknotes whose serial numbers match the dates that matter. A brand of Lexoraa Luxury Private Limited.',
  alternates: { canonical: '/about' },
};
export const dynamic = 'force-dynamic';

export default async function AboutPage() {
  const user = await currentUser();

  return (
    <div>
      <SiteHeader user={user} compact />

      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-14 leading-relaxed text-slate">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
            The Archive
          </p>
          <h1 className="mt-2 font-display text-3xl text-slate sm:text-4xl">
            Where numbers become heirlooms
          </h1>
        </div>

        <p>
          A banknote numbered 120478 is not just currency. To the right person it is
          12 April 1978 — a birthday, a wedding, the day a business opened. Our engine reads
          every serial number the way a person would, works out which dates it can mean, and
          puts it in front of the one buyer for whom that number is not a number at all.
        </p>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-2xl">How a note is described</h2>
          <p className="text-slate-dim">
            Every listing is decomposed rather than typed in by hand. The prefix, the inset
            letter, the star marking and each digit are read separately, then checked against
            the calendar — leap years included, so a note can never be listed as a date that
            does not exist. Fancy-number patterns are identified the same way: solids, radars,
            ladders, repeaters, low serials, and the auspicious numbers collectors seek out.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-2xl">One serial, one listing</h2>
          <p className="text-slate-dim">
            A serial number is a note&rsquo;s identity. The same serial cannot be listed twice
            while a sale is live — enforced by the database itself, not by a check that could
            be raced past. When a note sells, the record stays, so its history follows it.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-2xl">Who we are</h2>
          <p className="text-slate-dim">
            {COMPANY.brand} is a brand of <span className="text-slate">{COMPANY.legalName}</span>,
            registered in Mumbai.
          </p>
          <address className="not-italic text-sm text-slate-dim">
            {formattedAddress()}
            <br />
            <span className="font-mono">
              CIN {COMPANY.cin} &middot; GSTIN {COMPANY.gstin}
            </span>
          </address>
          <p className="text-sm text-slate-dim">
            We are an independent collectibles marketplace. We are not affiliated with, endorsed
            by, or licensed by the Reserve Bank of India, the India Government Mint, or any
            government body. Notes are offered as numismatic collectibles at a
            collector&rsquo;s premium, not as currency exchange. &ldquo;Minting&rdquo; in our name
            refers to the collectible craft, not to any mint authority.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
