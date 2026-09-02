import type { Metadata } from 'next';

import { COMPANY, REFUND_POLICY, rupees } from '@rareminting/config';

import { PolicyPage, Rows, Section } from '@/components/PolicyPage.tsx';

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'The terms on which Rare Minting operates as a marketplace for collectible notes.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <PolicyPage
      eyebrow="Terms"
      title="Terms of use"
      intro={
        <p className="text-slate-dim">
          These govern your use of rareminting.com, operated by {COMPANY.legalName}. By creating an
          account you accept them.
        </p>
      }
    >
      <Section id="what" heading="What is being sold">
        <p>
          Every item here is a <strong>numismatic collectible</strong>, bought and sold at a
          collector&rsquo;s premium for its rarity, its serial number or the date it represents.
          Nothing on this site is currency exchange, money changing, or a financial product.
        </p>
        <p className="text-slate-dim">
          We are an independent marketplace. We are not affiliated with, endorsed by, or licensed
          by the Reserve Bank of India, the India Government Mint, or any government body.
          &ldquo;Minting&rdquo; in our name refers to the collectible craft.
        </p>
        <p className="text-slate-dim">
          A collectible has no guaranteed resale value. What you pay reflects what a collector will
          pay, which moves. Nothing here is investment advice.
        </p>
      </Section>

      <Section id="marketplace" heading="Our role">
        <p className="text-slate-dim">
          We operate the marketplace. Items are sold by their sellers, not by us. We verify
          sellers, hold payment until delivery is confirmed, and arbitrate disputes on the evidence
          both sides provide — but the contract of sale is between buyer and seller.
        </p>
      </Section>

      <Section id="accounts" heading="Your account">
        <Rows
          items={[
            ['One person, one account', 'Accounts are personal and may not be shared or sold.'],
            [
              'Keep it secure',
              'You are responsible for what happens under your account. Tell us at once if you think someone else has access.',
            ],
            [
              'Accurate details',
              'Give correct information, especially for verification and delivery. Verification exists precisely so buyers can trust who they are dealing with.',
            ],
            [
              'Eighteen or over',
              'You must be old enough to enter a contract in your jurisdiction.',
            ],
          ]}
        />
      </Section>

      <Section id="sellers" heading="If you sell">
        <Rows
          items={[
            [
              'Describe it truthfully',
              'The serial number, denomination, series and condition must match the item exactly. The serial is the item’s identity; any discrepancy entitles the buyer to a refund.',
            ],
            [
              'Own what you list',
              'You must have the legal right to sell it. Listing stolen, counterfeit or altered material is grounds for immediate removal and for us to involve the authorities.',
            ],
            [
              'Your own photographs',
              'Images must be of the actual item. Stock photographs and images taken from other listings are not permitted, and are detected.',
            ],
            [
              'One live listing per note',
              'The same serial cannot be listed twice while a sale is live. This is enforced by the system, not merely asked of you.',
            ],
            [
              'Ship promptly',
              'Dispatch within the stated time and provide tracking. See the shipping policy for insurance and unboxing-video requirements.',
            ],
            [
              'Verification before payout',
              'Listing is open to any account. Being paid requires completed verification and a verified bank account.',
            ],
          ]}
        />
      </Section>

      <Section id="buyers" heading="If you buy">
        <Rows
          items={[
            [
              'An order is a commitment',
              'Placing an order reserves the item and takes it off the market. Cancellation is covered by the refund policy.',
            ],
            [
              'Inspect on arrival',
              `You have ${REFUND_POLICY.inspectionWindowDays} days from delivery to examine the item and raise a claim. Payment is held for that whole window.`,
            ],
            [
              'A winning bid is binding',
              'At auction, the highest bid at close is a commitment to buy. Non-payment results in a strike against the account.',
            ],
          ]}
        />
      </Section>

      <Section id="fees" heading="Fees">
        <p className="text-slate-dim">
          Buyers pay the listed price plus any shipping shown at checkout. Sellers pay a commission
          on the sale price, GST on that commission, and have tax withheld under section 194-O
          where it applies. Every deduction is itemised on the order page before and after the sale
          — the seller always sees exactly what reaches them.
        </p>
      </Section>

      <Section id="prohibited" heading="What is not allowed">
        <Rows
          items={[
            ['Counterfeit or altered items', 'Including cleaned, pressed or repaired notes sold as original.'],
            ['Bidding on your own lots', 'Shill bidding, or arranging for others to bid up your items.'],
            ['Taking a trade off-platform', 'To avoid fees, and with it the protection the escrow gives both sides.'],
            ['Defacing notes', 'We do not encourage writing on, stapling or otherwise damaging currency.'],
            ['Scraping or automated abuse', 'Including attempts to overwhelm the service.'],
          ]}
        />
      </Section>

      <Section id="suspension" heading="Suspension">
        <p className="text-slate-dim">
          We may withdraw a listing, suspend an account or refuse a sale where these terms are
          broken. Where we do, we say why. A suspended seller is still paid for completed sales
          that were delivered and unclaimed.
        </p>
      </Section>

      <Section id="liability" heading="Liability">
        <p className="text-slate-dim">
          We are responsible for operating the marketplace as described and for handling escrow and
          disputes fairly. We are not the seller, and our liability for any single order does not
          exceed the amount paid for it. Nothing here limits liability that cannot lawfully be
          limited.
        </p>
      </Section>

      <Section id="law" heading="Governing law">
        <p className="text-slate-dim">
          These terms are governed by the laws of India. Disputes fall to the courts of Mumbai,
          Maharashtra.
        </p>
      </Section>

      <Section id="changes" heading="Changes">
        <p className="text-slate-dim">
          We may update these terms. Material changes will be notified to registered accounts
          before they take effect. Orders already placed remain governed by the terms in force when
          they were made — including the fees, which are recorded on each order at the moment it is
          created.
        </p>
        <p className="text-sm text-slate-dim">
          Questions: see the{' '}
          <a href="/contact" className="text-accent-deep underline underline-offset-4">
            contact page
          </a>
          . High-value orders — above {rupees(REFUND_POLICY.insuredShippingThresholdPaise)} — carry
          extra shipping requirements set out in the shipping policy.
        </p>
      </Section>
    </PolicyPage>
  );
}
