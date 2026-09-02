import type { ReactNode } from 'react';

import { POLICY_LAST_UPDATED } from '@rareminting/config';

import { SiteFooter } from './SiteFooter.tsx';
import { Wordmark } from './Wordmark.tsx';

/**
 * Shared shell for the policy pages, so they read as one document set rather
 * than four pages that happen to share a colour scheme.
 */
export function PolicyPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <header className="guilloche bg-primary">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-5 py-10">
          <a href="/" aria-label="Rare Minting home">
            <Wordmark />
          </a>
          <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-accent-bright">
            {eyebrow}
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-5 py-14 text-[0.95rem] leading-relaxed text-slate">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-3xl text-slate sm:text-4xl">{title}</h1>
          <p className="text-sm text-slate-dim">Last updated {POLICY_LAST_UPDATED}.</p>
          {intro}
        </div>
        {children}
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
