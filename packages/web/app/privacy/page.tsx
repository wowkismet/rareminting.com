import type { Metadata } from 'next';

import { COMPANY, REFUND_POLICY } from '@rareminting/config';

import { PolicyPage, Rows, Section } from '@/components/PolicyPage.tsx';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'What Rare Minting collects, why, how long it is kept, and the rights you have over it.',
  alternates: { canonical: '/privacy' },
};

/**
 * Written against what the system actually stores, not from a template. Each
 * item below corresponds to a real column; nothing is claimed that the platform
 * does not do, and nothing it does do is omitted.
 */
export default function PrivacyPage() {
  return (
    <PolicyPage
      current="/privacy"
      eyebrow="Privacy"
      title="Privacy policy"
      intro={
        <p className="text-slate-dim">
          {COMPANY.legalName} operates rareminting.com. This explains what we hold about you, why,
          and what you can ask us to do with it. It is written against what the system actually
          stores.
        </p>
      }
    >
      <Section id="collect" heading="What we hold">
        <Rows
          items={[
            [
              'Your account',
              'Email address, and a name and phone number if you give them. Your password is never stored — only a scrypt hash of it, which cannot be reversed back into your password.',
            ],
            [
              'Sessions',
              'A record that you are signed in, on which device and from which IP. Only a hash of the session token is kept, so a copy of our database would not let anyone sign in as you.',
            ],
            [
              'Seller details',
              'If you sell: your trading name, business type, and GSTIN if you have one.',
            ],
            [
              'Verification documents',
              'If you complete seller verification: the document itself in secure storage, plus a one-way hash of the number and its last four characters. We never store a PAN or Aadhaar number in readable form.',
            ],
            [
              'Bank details for payouts',
              'A token from the payment provider, the last four digits, and the IFSC. The full account number never reaches us.',
            ],
            [
              'Listings and orders',
              'What you list or buy, the serial numbers, prices, delivery address and order history.',
            ],
            [
              'Saved dates',
              'The dates you ask to be alerted about. These can be personal — a birthday, an anniversary — so they are treated as such and are never shared.',
            ],
            [
              'Security records',
              'Sign-in attempts, IP addresses and a device fingerprint, kept to detect account takeover and shill bidding.',
            ],
          ]}
        />
      </Section>

      <Section id="why" heading="Why we hold it">
        <p className="text-slate-dim">
          To run your account, list and sell items, take orders, arrange delivery, settle payouts,
          meet tax and record-keeping obligations, and to keep the marketplace safe from fraud. We
          do not sell your data, and we do not use it for advertising profiling.
        </p>
      </Section>

      <Section id="sharing" heading="Who else sees it">
        <Rows
          items={[
            [
              'The other party to a trade',
              'A seller receives the delivery address for an order. A buyer sees the seller’s trading name. Neither sees the other’s email or phone.',
            ],
            [
              'Payment provider',
              'Order amounts and the details needed to take payment and settle a payout. Card and bank details go directly to them, not through us.',
            ],
            [
              'Verification provider',
              'Documents you submit for seller verification, for the purpose of checking them.',
            ],
            ['Couriers', 'The delivery name, address and phone number, so a parcel can arrive.'],
            [
              'Authorities',
              'Where the law requires it — a valid legal request, a tax filing, or a court order.',
            ],
          ]}
        />
      </Section>

      <Section id="retention" heading="How long we keep it">
        <p className="text-slate-dim">
          Account and order records are kept while your account is open and afterwards for as long
          as tax and company law requires us to retain transaction records. Sign-in attempt logs
          are short-lived and used only for rate limiting. Our audit trail is append-only and
          cannot be edited — it records that an action happened and by whom, which is what makes a
          disputed order resolvable.
        </p>
      </Section>

      <Section id="rights" heading="Your rights">
        <p className="text-slate-dim">
          Under the Digital Personal Data Protection Act you may ask us for a copy of what we hold,
          ask us to correct it, withdraw consent, or ask us to erase it.
        </p>
        <p className="text-slate-dim">
          Erasure has one limit worth stating plainly. We can remove everything that identifies
          you — your name, email, phone, addresses and saved dates — and we will. We cannot delete
          the record that an order or a bid happened, because a completed trade involves another
          person who has rights of their own, and tax law requires the transaction to be retained.
          What remains after erasure is an identifier that no longer points to a person.
        </p>
      </Section>

      <Section id="security" heading="How it is protected">
        <Rows
          items={[
            ['In transit', 'Every page and request is served over HTTPS.'],
            [
              'Passwords',
              'Hashed with scrypt, a deliberately slow and memory-hard function, so a stolen hash is impractical to reverse.',
            ],
            [
              'Sessions',
              'The token in your browser is stored in a cookie no script can read, which is what stops a cross-site scripting bug from stealing your session.',
            ],
            [
              'Database',
              'Reachable only from the application server. It is not exposed to the internet.',
            ],
          ]}
        />
        <p className="text-sm text-slate-dim">
          No system is perfect. If we discover a breach affecting your data we will tell you and the
          Data Protection Board as the law requires.
        </p>
      </Section>

      <Section id="cookies" heading="Cookies">
        <p className="text-slate-dim">
          One cookie, to keep you signed in. No advertising cookies, no third-party trackers, and
          no analytics that follow you between sites. Clearing it signs you out.
        </p>
      </Section>

      <Section id="contact" heading="Asking us about your data">
        <p className="text-slate-dim">
          Write to us through the{' '}
          <a href="/contact" className="text-accent-deep underline underline-offset-4">
            contact page
          </a>
          . We aim to respond within {REFUND_POLICY.inspectionWindowDays * 10} days.
        </p>
        <p className="text-sm text-slate-dim">
          {COMPANY.legalName}, {COMPANY.address.line1}, {COMPANY.address.line2},{' '}
          {COMPANY.address.city} {COMPANY.address.postalCode}.
        </p>
      </Section>
    </PolicyPage>
  );
}
