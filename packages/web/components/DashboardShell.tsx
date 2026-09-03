import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import type { ApiUser } from '@/lib/api.ts';

/**
 * The signed-in frame: a left menu beside the working area.
 *
 * One shell for all three roles, because a seller who is also an admin — which
 * the people running this site are — should not have to learn two layouts. The
 * menu changes, the furniture does not.
 *
 * Server-rendered with plain links and no client JavaScript. The current item
 * is marked with aria-current so it is announced, not merely coloured.
 */

export interface MenuItem {
  readonly href: string;
  readonly label: string;
  /** Shown as a count beside the label. Omit when there is nothing to say. */
  readonly badge?: number | undefined;
}

export interface MenuSection {
  readonly title: string;
  readonly items: readonly MenuItem[];
}

export function DashboardShell({
  user,
  eyebrow,
  title,
  subtitle,
  sections,
  current,
  action,
  children,
}: {
  user: ApiUser | null;
  eyebrow: string;
  title: string;
  subtitle?: string | undefined;
  sections: readonly MenuSection[];
  /** Pathname of the page being shown, to mark the active item. */
  current: string;
  /** Optional primary button, top right. */
  action?: { href: string; label: string } | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader user={user} compact />

      <div className="flex w-full flex-1 flex-col md:flex-row">
        {/* A dark rail, so the working area reads as a console rather than a
            page with a sidebar bolted on. On a phone it becomes a horizontal
            strip above the content rather than a drawer, so nothing needs
            JavaScript to open. */}
        <nav
          aria-label="Dashboard"
          className="shrink-0 bg-primary px-5 py-6 md:w-60 md:px-4 md:py-8"
        >
          <div className="flex flex-col gap-6">
            {sections.map((section) => (
              <div key={section.title}>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream-dim/70">
                  {section.title}
                </p>
                <ul className="mt-3 flex flex-wrap gap-1.5 md:flex-col md:gap-0.5">
                  {section.items.map((item) => {
                    const active = item.href === current;
                    return (
                      <li key={item.href}>
                        <a
                          href={item.href}
                          {...(active ? { 'aria-current': 'page' as const } : {})}
                          className={
                            active
                              ? 'flex items-center justify-between gap-3 rounded-sm bg-accent/15 px-3 py-2 text-sm text-accent-bright ring-1 ring-accent/30'
                              : 'flex items-center justify-between gap-3 rounded-sm px-3 py-2 text-sm text-cream-dim transition-colors hover:bg-cream/10 hover:text-cream'
                          }
                        >
                          <span>{item.label}</span>
                          {item.badge !== undefined && item.badge > 0 && (
                            <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] tabular-nums text-ink">
                              {item.badge}
                            </span>
                          )}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <main className="min-w-0 flex-1 px-5 py-8 md:px-8">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
                {eyebrow}
              </p>
              <h1 className="mt-2 font-display text-3xl text-slate">{title}</h1>
              {subtitle !== undefined && (
                <p className="mt-2 text-sm text-slate-dim">{subtitle}</p>
              )}
            </div>
            {action !== undefined && (
              <a
                href={action.href}
                className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                {action.label}
              </a>
            )}
          </div>

          {children}
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}

/** A statistic. Used across all three dashboards so they read alike. */
export function Tile({
  label,
  value,
  hint,
  accent = false,
  alert = false,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  accent?: boolean;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-sm border p-4 ${
        alert ? 'border-ember/50 bg-ember/5' : 'border-sand-line bg-sand-raised'
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">{label}</p>
      <p
        className={`mt-2 font-display text-3xl tabular-nums ${
          alert ? 'text-ember' : accent ? 'text-accent-deep' : 'text-slate'
        }`}
      >
        {value}
      </p>
      {hint !== undefined && <p className="mt-1 text-xs text-slate-dim">{hint}</p>}
    </div>
  );
}

/** An empty state that offers the next action rather than just apologising. */
export function Empty({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: { href: string; label: string } | undefined;
}) {
  return (
    <div className="rounded-sm border border-sand-line bg-sand-raised p-8 text-sm text-slate-dim">
      <p>{children}</p>
      {action !== undefined && (
        <a
          href={action.href}
          className="mt-5 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
