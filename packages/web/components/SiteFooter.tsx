import { COMPANY, formattedAddress } from '@rareminting/config';

/**
 * The site footer: every page, every policy, and who is behind the site.
 *
 * Shared rather than repeated because the entity details are legally
 * significant — a CIN that differs between two pages is a real problem, and
 * rendering both from one component is the only reliable way to prevent it.
 *
 * Every link here points at a page that exists. A dead link in a legal footer
 * is worse than no link at all.
 */

const SECTIONS = [
  {
    heading: 'Marketplace',
    links: [
      { href: '/browse', label: 'Buy notes' },
      { href: '/auctions', label: 'Auctions' },
      { href: '/sell', label: 'Sell a note' },
      { href: '/orders', label: 'Your orders' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { href: '/signup', label: 'Create account' },
      { href: '/signin', label: 'Sign in' },
      { href: '/account', label: 'Your account' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about', label: 'About us' },
      { href: '/contact', label: 'Contact & grievances' },
    ],
  },
  {
    heading: 'Policies',
    links: [
      { href: '/terms', label: 'Terms of use' },
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/refunds', label: 'Refunds & cancellations' },
      { href: '/shipping', label: 'Shipping & delivery' },
    ],
  },
] as const;

export function SiteFooter({ noteCount }: { noteCount?: number | undefined }) {
  return (
    <footer className="bg-primary">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <nav
          aria-label="Footer"
          className="grid gap-8 border-b border-line pb-10 sm:grid-cols-2 lg:grid-cols-4"
        >
          {SECTIONS.map((section) => (
            <div key={section.heading} className="flex flex-col gap-3">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.28em] text-accent">
                {section.heading}
              </h2>
              <ul className="flex flex-col gap-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="text-sm text-cream-dim transition-colors hover:text-accent-bright"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-5 pt-10">
          <p className="max-w-3xl text-xs leading-relaxed text-cream-dim">
            {COMPANY.brand} is a brand of{' '}
            <span className="text-cream">{COMPANY.legalName}</span>. It is an independent
            collectibles marketplace, and is not affiliated with, endorsed by, or licensed by the
            Reserve Bank of India, the India Government Mint, or any government body. Notes are
            offered as numismatic collectibles at a collector&rsquo;s premium, not as currency
            exchange.
          </p>

          <address className="max-w-3xl text-xs not-italic leading-relaxed text-cream-dim">
            {formattedAddress()}
            <br />
            <span className="font-mono">
              CIN {COMPANY.cin} · GSTIN {COMPANY.gstin}
            </span>
          </address>

          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream-dim">
            www.rareminting.com
            {noteCount === undefined ? '' : ` · ${noteCount} notes`} · &copy;{' '}
            {new Date().getFullYear()} {COMPANY.legalName}
          </p>
        </div>
      </div>
    </footer>
  );
}
