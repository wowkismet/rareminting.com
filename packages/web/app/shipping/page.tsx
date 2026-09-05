import type { Metadata } from 'next';

import { REFUND_POLICY, rupees } from '@rareminting/config';

import { PolicyPage, Rows, Section } from '@/components/PolicyPage.tsx';

export const metadata: Metadata = {
  title: 'Shipping & delivery',
  description: 'How notes are packed, shipped, insured and confirmed on delivery.',
  alternates: { canonical: '/shipping' },
};

export default function ShippingPage() {
  return (
    <PolicyPage
      current="/shipping"
      eyebrow="Shipping"
      title="Shipping &amp; delivery"
      intro={
        <p className="text-slate-dim">
          A banknote is light, flat and easily ruined. How it travels matters as much as how it was
          described.
        </p>
      }
    >
      <Section id="dispatch" heading="Dispatch">
        <p className="text-slate-dim">
          Sellers dispatch within <strong>3 working days</strong> of an order being confirmed, and
          add a tracking number. You are told when it ships. If a seller does not dispatch within 7
          days, you may cancel for a full refund.
        </p>
      </Section>

      <Section id="packaging" heading="Packaging">
        <Rows
          items={[
            [
              'Rigid and sealed',
              'Notes travel in a currency sleeve inside rigid card, in a tamper-evident outer. A note that arrives creased in the post is a note that was packed flat in an envelope.',
            ],
            [
              'No adhesive on the note',
              'Nothing is taped, stapled or stuck to the item itself, ever.',
            ],
            [
              'Discreet',
              'Outer packaging does not advertise that it contains currency.',
            ],
          ]}
        />
      </Section>

      <Section id="insured" heading="Insured shipping">
        <p>
          Orders above <strong>{rupees(REFUND_POLICY.insuredShippingThresholdPaise)}</strong> must
          be sent insured, and the seller must record an{' '}
          <strong>unboxing video</strong> of the item being packed.
        </p>
        <p className="text-slate-dim">
          The video is not bureaucracy. Without it, a damage claim on a high-value note comes down
          to one person&rsquo;s word against another&rsquo;s, and someone loses unfairly. With it,
          the evidence settles it.
        </p>
      </Section>

      <Section id="delivery" heading="Delivery">
        <Rows
          items={[
            [
              'Tracked throughout',
              'Every order ships tracked. You can follow it from your order page.',
            ],
            [
              'Confirmation on arrival',
              'Delivery is confirmed by the courier, and for higher-value orders by a one-time code given to the courier at the door.',
            ],
            [
              'Then the inspection window',
              `Delivery starts your ${REFUND_POLICY.inspectionWindowDays}-day window to examine the note. The seller is not paid until it closes.`,
            ],
          ]}
        />
      </Section>

      <Section id="where" heading="Where we ship">
        <p className="text-slate-dim">
          Across India. International delivery is not yet offered — export of collectible currency
          carries customs requirements we would rather meet properly than approximately.
        </p>
      </Section>

      <Section id="cost" heading="Cost">
        <p className="text-slate-dim">
          Shipping is shown at checkout before you commit, and is never added afterwards. Where a
          refund is approved because an item was not as described, damaged or not authentic, return
          postage is on us and we provide a prepaid label — see the{' '}
          <a href="/refunds" className="text-accent-deep underline underline-offset-4">
            refunds policy
          </a>
          .
        </p>
      </Section>

      <Section id="problems" heading="If it does not arrive">
        <p className="text-slate-dim">
          Raise a claim from the order page. A tracked parcel that does not reach you is refunded
          in full — that risk sits with us and the seller, not with you.
        </p>
      </Section>
    </PolicyPage>
  );
}
