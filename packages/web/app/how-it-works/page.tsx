import type { Metadata } from 'next';

import { COMPANY, REFUND_POLICY, rupees } from '@rareminting/config';

import { PolicyPage, Section } from '@/components/PolicyPage.tsx';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'How Rare Minting reads a banknote serial for the dates it can spell, and how buying and selling works.',
  alternates: { canonical: '/how-it-works' },
};

const { inspectionWindowDays, freeCancellationHours } = REFUND_POLICY;

export default function HowItWorksPage() {
  return (
    <PolicyPage
      eyebrow="How it works"
      title="How Rare Minting works"
      intro={
        <p className="text-slate-dim">
          The idea is small and the whole site follows from it: a banknote serial number is a
          string of digits, and some strings of digits are dates. Find the note whose serial spells
          the day that matters to you.
        </p>
      }
    >
      <Section id="reading" heading="How a serial becomes a date">
        <p>
          Every serial listed here is read once, when it is listed, and everything the site knows
          about it is derived from that reading. A six-digit run like <strong>150892</strong> can be
          read as 15 August 1992. The same digits could also be read the American way round, or as
          a two-digit year in a different century, so we record{' '}
          <strong>every reading the digits allow</strong> and rank them by how likely each is.
        </p>
        <p>
          That is why searching a date is fast: the readings are already in the database, indexed.
          We are not scanning the catalogue and guessing when you search — the work was done when
          the note was listed.
        </p>
        <p>
          It is a rules engine, not a guess. It knows how many days each month has, which years
          were leap years, and which century a two-digit year most plausibly belongs to. A serial
          reading 300292 is refused, because 1992 was not a leap year.
        </p>
      </Section>

      <Section id="patterns" heading="What else the engine notices">
        <p>
          Dates are not the only thing that makes a serial worth having. The same reading tags every
          fancy-number pattern a serial carries — solid runs, radars that read the same backwards,
          ladders, repeaters, low numbers — and star replacement notes, which are printed to replace
          a spoiled note and are scarcer than their ordinary siblings.
        </p>
      </Section>

      <Section id="buying" heading="Buying">
        <p>
          Search your date, open a note, and buy it outright or make an offer. Your payment is held
          rather than passed straight to the seller.
        </p>
        <p>
          When the note reaches you, a <strong>{inspectionWindowDays}-day inspection window</strong>{' '}
          opens. The seller is not paid until it closes. If the serial is wrong, the condition is
          worse than described, or the note is not authentic, you get your money back. You can also
          cancel for any reason within {freeCancellationHours} hours if the seller has not yet
          dispatched.
        </p>
        <p>
          Orders above {rupees(REFUND_POLICY.insuredShippingThresholdPaise)} must be shipped
          insured. See{' '}
          <a href="/refunds" className="text-accent-deep underline underline-offset-4">
            refunds and cancellations
          </a>{' '}
          for the full terms.
        </p>
      </Section>

      <Section id="selling" heading="Selling">
        <p>
          Registering takes six details: your name, mobile, email, PAN and Aadhaar, and a one-time
          code. We are required to know who is selling before we can pay anyone out.
        </p>
        <p>
          We do not keep your PAN or Aadhaar number. Both are converted to a one-way fingerprint the
          moment they arrive; what remains on file is the last four characters, so support can tell
          which card you are holding. Nobody here, including an administrator, can read them back.
        </p>
        <p>
          An administrator reviews your details. Once approved there is{' '}
          <strong>no limit on how much you can list</strong>, and listing is free. You can prepare
          listings and add photographs while you wait, and publish them the moment you are approved.
        </p>
      </Section>

      <Section id="grading" heading="Condition and grading">
        <p>
          Sellers state a condition using the standard numismatic ladder — UNC for an uncirculated
          note down through AU, XF, VF, F, VG and G. That grade is the seller&rsquo;s own
          assessment, not ours, and the photographs are what you should judge by. A grade materially
          below the one advertised is grounds for a refund.
        </p>
      </Section>

      <Section id="honest" heading="What we do not do yet">
        <p>
          Some things are worth being plain about, because other sites in this category claim them.
        </p>
        <ul className="flex list-none flex-col gap-3 p-0">
          <li className="border-l-2 border-sand-line pl-4">
            <strong>There is no camera scanner.</strong>{' '}
            <span className="text-slate-dim">
              You type the serial in. We do not read it from a photograph, and we would rather say
              so than imply an accuracy we cannot deliver.
            </span>
          </li>
          <li className="border-l-2 border-sand-line pl-4">
            <strong>We do not value your note.</strong>{' '}
            <span className="text-slate-dim">
              The engine says what a serial reads as and what patterns it carries. What that is
              worth is set by what a buyer will pay.
            </span>
          </li>
          <li className="border-l-2 border-sand-line pl-4">
            <strong>Auctions are not open yet.</strong>{' '}
            <span className="text-slate-dim">
              Everything currently sells at a fixed price or by offer.
            </span>
          </li>
          <li className="border-l-2 border-sand-line pl-4">
            <strong>Date alerts are not switched on.</strong>{' '}
            <span className="text-slate-dim">
              We cannot yet write to you when a note matching your date is listed. Until we can, the
              honest advice is to check back.
            </span>
          </li>
        </ul>
      </Section>

      <Section id="who" heading="Who you are dealing with">
        <p className="text-slate-dim">
          {COMPANY.brand} is operated by {COMPANY.legalName}. We are a marketplace: the seller of
          each note is the person who listed it, not us.
        </p>
        <p>
          <a href="/contact" className="text-accent-deep underline underline-offset-4">
            Contact and grievances
          </a>
        </p>
      </Section>
    </PolicyPage>
  );
}
