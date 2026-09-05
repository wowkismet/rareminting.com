import type { ReactNode } from 'react';

import { POLICY_LAST_UPDATED } from '@rareminting/config';
import { currentUser } from '@/lib/session.ts';

import { SiteFooter } from './SiteFooter.tsx';
import { SiteHeader } from './SiteHeader.tsx';

/**
 * Shared shell for the policy pages, so they read as one document set rather
 * than four pages that happen to share a colour scheme.
 *
 * These carry the site's own header rather than a wordmark on its own. They
 * had the wordmark, which left anybody who arrived on the refunds page — often
 * from a search engine, part-way through deciding whether to trust the site —
 * with no way onward except the logo. A policy page is a sales page whether or
 * not it is written like one.
 *
 * The four are cross-linked at the foot for the same reason: somebody reading
 * about refunds usually wants shipping next.
 */
const POLICIES: readonly { href: string; label: string }[] = [
  { href: '/terms', label: 'Terms of use' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/refunds', label: 'Refunds & cancellations' },
  { href: '/shipping', label: 'Shipping & delivery' },
];

export async function PolicyPage({
  eyebrow,
  title,
  intro,
  current,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  /** Pathname of this policy, so it is not offered as a link to itself. */
  current?: string;
  children: ReactNode;
}) {
  const user = await currentUser();

  return (
    <div>
      <SiteHeader user={user} compact />

      <div className="guilloche bg-primary">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 px-5 py-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-accent-bright">
            {eyebrow}
          </p>
        </div>
      </div>

      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-5 py-14 text-[0.95rem] leading-relaxed text-slate">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-3xl text-slate sm:text-4xl">{title}</h1>
          <p className="text-sm text-slate-dim">Last updated {POLICY_LAST_UPDATED}.</p>
          {intro}
        </div>
        {children}

        {/* The other three. Somebody reading about refunds usually wants
            shipping next, and should not have to go via the footer. */}
        <nav aria-label="Other policies" className="border-t border-sand-line pt-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-slate-dim">
            The other policies
          </p>
          <ul className="mt-4 flex flex-wrap gap-3">
            {POLICIES.filter((p) => p.href !== current).map((p) => (
              <li key={p.href}>
                <a
                  href={p.href}
                  className="inline-block rounded-full border border-sand-line px-4 py-2 text-sm text-slate transition-colors hover:border-accent-deep"
                >
                  {p.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </main>

      <SiteFooter />
    </div>
  );
}

export function Section({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-8 flex-col gap-3">
      <h2 className="font-display text-2xl text-slate">{heading}</h2>
      {children}
    </section>
  );
}

/** A definition-style row, for "what we collect and why" tables. */
export function Rows({
  items,
}: {
  items: readonly (readonly [string, string])[];
}) {
  return (
    <ul className="flex list-none flex-col gap-3 p-0">
      {items.map(([term, detail]) => (
        <li key={term} className="border-l-2 border-accent-deep/50 pl-4">
          <strong className="text-slate">{term}.</strong>{' '}
          <span className="text-slate-dim">{detail}</span>
        </li>
      ))}
    </ul>
  );
}
