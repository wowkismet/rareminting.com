import type { Metadata } from 'next';

import { COMPANY, formattedAddress } from '@rareminting/config';

import { PolicyPage, Section } from '@/components/PolicyPage.tsx';

export const metadata: Metadata = {
  title: 'Contact & grievances',
  description: 'How to reach Rare Minting, and how to escalate a complaint.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage() {
  const officer = COMPANY.grievanceOfficer;

  return (
    <PolicyPage
      eyebrow="Contact"
      title="Contact &amp; grievances"
      intro={
        <p className="text-slate-dim">
          For anything to do with a specific order, start from the order page — it reaches the
          other party and creates the record a decision is made on.
        </p>
      }
    >
      <Section id="company" heading="Registered office">
        <address className="not-italic text-slate-dim">
          <span className="text-slate">{COMPANY.legalName}</span>
          <br />
          {formattedAddress()}
          <br />
          <span className="font-mono text-sm">
            CIN {COMPANY.cin}
            <br />
            GSTIN {COMPANY.gstin}
          </span>
        </address>
      </Section>

      <Section id="support" heading="Support">
        {COMPANY.supportEmail === null ? (
          <p className="rounded-sm border border-accent-deep/40 bg-sand-raised p-4 text-slate-dim">
            A support address is being set up and will be published here. In the meantime, raise
            anything order-related from the order page in your account, which reaches us directly.
          </p>
        ) : (
          <p className="text-slate-dim">
            <a
              href={`mailto:${COMPANY.supportEmail}`}
              className="text-accent-deep underline underline-offset-4"
            >
              {COMPANY.supportEmail}
            </a>
          </p>
        )}
      </Section>

      <Section id="grievance" heading="Grievance officer">
        <p className="text-slate-dim">
          If a complaint has not been resolved to your satisfaction, it can be escalated to our
          grievance officer, appointed under the Consumer Protection (E-Commerce) Rules and the
          Information Technology Rules.
        </p>
        {officer === null ? (
          <p className="rounded-sm border border-accent-deep/40 bg-sand-raised p-4 text-slate-dim">
            The grievance officer&rsquo;s name and contact details are to be published here before
            the marketplace begins taking payments. We would rather show this notice than a name
            that is not yet real.
          </p>
        ) : (
          <address className="not-italic text-slate-dim">
            <span className="text-slate">{officer.name}</span>
            <br />
            <a
              href={`mailto:${officer.email}`}
              className="text-accent-deep underline underline-offset-4"
            >
              {officer.email}
            </a>
            <br />
            {officer.phone}
          </address>
        )}
        <p className="text-sm text-slate-dim">
          We acknowledge a grievance within 48 hours and aim to resolve it within one month.
        </p>
      </Section>

      <Section id="policies" heading="Our policies">
        <ul className="flex list-none flex-col gap-2 p-0 text-slate-dim">
          <li>
            <a href="/terms" className="text-accent-deep underline underline-offset-4">
              Terms of use
            </a>
          </li>
          <li>
            <a href="/privacy" className="text-accent-deep underline underline-offset-4">
              Privacy policy
            </a>
          </li>
          <li>
            <a href="/refunds" className="text-accent-deep underline underline-offset-4">
              Refunds &amp; cancellations
            </a>
          </li>
          <li>
            <a href="/shipping" className="text-accent-deep underline underline-offset-4">
              Shipping &amp; delivery
            </a>
          </li>
        </ul>
      </Section>
    </PolicyPage>
  );
}
