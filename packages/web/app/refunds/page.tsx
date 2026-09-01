import type { Metadata } from 'next';

import { COMPANY, POLICY_LAST_UPDATED, REFUND_POLICY, rupees } from '@rareminting/config';

import { SiteFooter } from '@/components/SiteFooter.tsx';
import { Wordmark } from '@/components/Wordmark.tsx';

export const metadata: Metadata = {
  title: 'Refunds & Cancellations',
  description:
    'When a Rare Minting order can be cancelled or refunded, how to raise a claim, and how long a refund takes.',
  alternates: { canonical: '/refunds' },
};

const {
  inspectionWindowDays,
  refundProcessingDays,
  insuredShippingThresholdPaise,
  freeCancellationHours,
} = REFUND_POLICY;

function Section({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-3 scroll-mt-8">
      <h2 className="font-display text-2xl text-slate">{heading}</h2>
      {children}
    </section>
  );
}

export default function RefundsPage() {
  return (
    <div>
      <header className="guilloche bg-primary">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-5 py-10">
          <a href="/" aria-label="Rare Minting home">
            <Wordmark />
          </a>
          <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-accent-bright">
            Refunds &amp; cancellations
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-5 py-14 text-[0.95rem] leading-relaxed text-slate">
        <p className="text-slate-dim">
          Last updated {POLICY_LAST_UPDATED}. This policy applies to every purchase made on
          rareminting.com from {COMPANY.legalName}, whether at a fixed price, through an accepted
          offer, or at auction.
        </p>

        <Section id="principle" heading="The principle">
          <p>
            You are buying a physical collectible whose value rests on being exactly what it is
            described to be. So we hold your payment until the item reaches you and you have had
            time to examine it. The seller is not paid until that window closes. If the note is not
            what was described, you get your money back.
          </p>
        </Section>

        <Section id="cancelling" heading="Cancelling before dispatch">
          <p>
            You can cancel any order for a full refund within {freeCancellationHours} hours of
            placing it, provided the seller has not yet dispatched the item. Cancel from your order
            page; the refund is issued automatically and no reason is required.
          </p>
          <p>
            After dispatch an order cannot be cancelled, but it may still be refunded under the
            inspection window below.
          </p>
        </Section>

        <Section id="inspection" heading={`The ${inspectionWindowDays}-day inspection window`}>
          <p>
            When an order is marked delivered, a{' '}
            <strong>{inspectionWindowDays}-day inspection window</strong> opens. During it you may
            raise a claim for any of the reasons below. Your payment is held for the whole window
            and is only released to the seller once it closes without a claim.
          </p>
          <p>
            The window is the protection. Once it closes and payment is released, a refund becomes
            much harder to obtain, so please examine the item as soon as it arrives.
          </p>
        </Section>

        <Section id="qualifies" heading="What qualifies for a refund">
          <ul className="flex list-none flex-col gap-3 p-0">
            {[
              [
                'The serial number is wrong',
                'The digits, prefix, inset letter or star marking differ from the listing. This is the single most important attribute of the item, and any discrepancy qualifies.',
              ],
              [
                'The condition is materially worse than stated',
                'Folds, tears, stains, pinholes, writing or staple marks not disclosed in the listing, or a grade materially below the one advertised.',
              ],
              [
                'The item is not authentic',
                'Any item found to be counterfeit, altered, or carrying a certification number that does not belong to it. This applies to auction lots too.',
              ],
              [
                'It arrived damaged',
                'Damage in transit, evidenced by photographs and, where required, the unboxing video.',
              ],
              ['It never arrived', 'The tracked shipment does not reach you.'],
              [
                'The wrong item was sent',
                'A different note, denomination or series from the one ordered.',
              ],
            ].map(([title, body]) => (
              <li key={title} className="border-l-2 border-accent-deep/50 pl-4">
                <strong className="text-slate">{title}.</strong>{' '}
                <span className="text-slate-dim">{body}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="not-covered" heading="What is not covered">
          <ul className="flex list-none flex-col gap-3 p-0">
            <li className="border-l-2 border-sand-line pl-4">
              <strong>Change of mind.</strong>{' '}
              <span className="text-slate-dim">
                Because handling affects the condition and provenance of a collectible, we do not
                accept returns simply because you no longer want the item. Read the listing and the
                photographs carefully before buying.
              </span>
            </li>
            <li className="border-l-2 border-sand-line pl-4">
              <strong>A change in market value.</strong>{' '}
              <span className="text-slate-dim">
                Collectible prices move. A fall in value after purchase is not grounds for a refund.
              </span>
            </li>
            <li className="border-l-2 border-sand-line pl-4">
              <strong>Disclosed characteristics.</strong>{' '}
              <span className="text-slate-dim">
                Anything described in the listing or visible in its photographs — a stated fold, a
                disclosed stain, a circulated grade — is not a defect.
              </span>
            </li>
            <li className="border-l-2 border-sand-line pl-4">
              <strong>Damage after delivery.</strong>{' '}
              <span className="text-slate-dim">
                Including damage caused by handling, cleaning, pressing, mounting or attempted
                repair.
              </span>
            </li>
            <li className="border-l-2 border-sand-line pl-4">
              <strong>Claims raised after the window closes.</strong>{' '}
              <span className="text-slate-dim">
                Except for authenticity, which can be raised at any time.
              </span>
            </li>
          </ul>
        </Section>

        <Section id="auctions" heading="Auction lots">
          <p>
            A winning bid is a binding commitment, and auction results are final. The one exception
            is <strong>authenticity</strong>: if a lot is later found not to be genuine, it is
            refundable in full regardless of how much time has passed.
          </p>
        </Section>

        <Section id="how" heading="How to raise a claim">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-slate-dim marker:text-accent-deep">
            <li>
              Open the order in your account and choose <strong>Raise a claim</strong> within the
              inspection window.
            </li>
            <li>
              Pick a reason and upload evidence — photographs of the item and its packaging, and the
              unboxing video where one is required.
            </li>
            <li>The seller has 48 hours to respond.</li>
            <li>
              If you and the seller do not reach agreement, {COMPANY.brand} reviews the evidence and
              decides. Our decision is made on the evidence submitted by both sides.
            </li>
          </ol>
        </Section>

        <Section id="returns" heading="Returning the item">
          <p>
            Where a refund is approved because the item was not as described, damaged, or not
            authentic, we pay for return shipping and provide a prepaid label. Send the item back in
            its original packaging within 7 days of approval.
          </p>
          <p>
            Orders above {rupees(insuredShippingThresholdPaise)} must be shipped insured, and an
            unboxing video is required to support a damage claim on them. This protects both sides:
            without it, a damage claim on a high-value note comes down to one person&rsquo;s word
            against another&rsquo;s.
          </p>
        </Section>

        <Section id="payment" heading="How refunds are paid">
          <p>
            Approved refunds go back to the original payment method — the same card, UPI handle or
            account used to pay. We cannot redirect a refund elsewhere.
          </p>
          <p>
            Money leaves us within {refundProcessingDays.min} to {refundProcessingDays.max} working
            days of approval. How long it then takes to appear depends on your bank or card issuer,
            typically a few days more.
          </p>
          <p>
            <strong>Partial refunds</strong> are possible where an item is largely as described but
            has an undisclosed flaw, and you would rather keep it at a reduced price than return it.
          </p>
        </Section>

        <Section id="contact" heading="If something goes wrong">
          <p>
            Raise a claim through your order page first — it reaches the seller and creates the
            record a decision is made on.
          </p>
          {COMPANY.grievanceOfficer === null ? (
            <p className="border border-accent-deep/40 bg-sand-raised p-4 text-slate-dim">
              Grievance officer contact details are to be published here before this policy takes
              effect.
            </p>
          ) : (
            <address className="not-italic">
              {COMPANY.grievanceOfficer.name}
              <br />
              {COMPANY.grievanceOfficer.email} · {COMPANY.grievanceOfficer.phone}
            </address>
          )}
          <p className="text-slate-dim">
            {COMPANY.legalName}, {COMPANY.address.line1}, {COMPANY.address.line2},{' '}
            {COMPANY.address.city} {COMPANY.address.postalCode}.
          </p>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
