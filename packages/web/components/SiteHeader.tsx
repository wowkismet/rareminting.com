import { signOut } from '@/app/actions.ts';
import { api, type ApiUser } from '@/lib/api.ts';
import { sessionToken } from '@/lib/session.ts';
import { Wordmark } from './Wordmark.tsx';

/**
 * The masthead: a utility strip, the search row, and the category rail.
 *
 * Flat brand green rather than the guilloche, which belongs on the panels
 * meant to look like a banknote and competes with the wordmark behind it.
 *
 * Every category leads to a filtered floor rather than a page that has to be
 * built later — the `kind` filter behind them is real. "Offers" is absent for
 * the opposite reason: there is no promotions system, so it would be a menu
 * item leading to whatever happened to be on the floor.
 *
 * The counts are fetched here rather than passed in, so they are right on
 * every page. One query for a signed-in visitor, none for anybody else.
 */

const CATEGORIES = [
  { href: '/browse?kind=banknote', label: 'Rare notes' },
  { href: '/browse?kind=coin', label: 'Rare coins' },
  { href: '/browse?kind=jewellery', label: 'Jewellery' },
  { href: '/browse?kind=precious_stone', label: 'Precious stones' },
  { href: '/browse?kind=stamp', label: 'Collectibles' },
  { href: '/browse?kind=antique', label: 'Antiques' },
  { href: '/auctions', label: 'Auctions' },
] as const;

/** What the dropdown beside the search box offers. */
const SEARCH_SCOPES = [
  { value: '', label: 'All categories' },
  { value: 'banknote', label: 'Rare notes' },
  { value: 'coin', label: 'Rare coins' },
  { value: 'jewellery', label: 'Jewellery' },
  { value: 'precious_stone', label: 'Precious stones' },
  { value: 'antique', label: 'Antiques' },
] as const;

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] tabular-nums text-ink">
      {n > 99 ? '99+' : n}
    </span>
  );
}

export async function SiteHeader({
  user,
  compact = false,
}: {
  user: ApiUser | null;
  compact?: boolean;
}) {
  const isAdmin = user?.roles.includes('admin') ?? false;
  const isSeller = user?.roles.includes('seller') ?? false;

  let cartCount = 0;
  let savedCount = 0;
  if (user !== null) {
    const token = await sessionToken();
    if (token !== null) {
      const [cart, saved] = await Promise.all([
        api<{ count?: number }>('/v1/cart', { token }),
        api<{ count?: number }>('/v1/saved', { token }),
      ]);
      cartCount = cart.ok ? (cart.data.count ?? 0) : 0;
      savedCount = saved.ok ? (saved.data.count ?? 0) : 0;
    }
  }

  const action =
    'relative flex items-center gap-2 text-sm text-cream-dim transition-colors hover:text-accent-bright';

  return (
    <header>
      {/* Utility strip */}
      <div className="border-b border-line/40 bg-ink">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-6 gap-y-1 px-5 py-2 sm:justify-between">
          <span aria-hidden className="hidden w-40 sm:block" />
          <p className="font-display text-xs italic text-accent">
            ◈ Where numbers &amp; rare become heirlooms. ◈
          </p>
          <nav aria-label="Support" className="flex items-center gap-5 text-xs">
            <a href="/orders" className="text-cream-dim transition-colors hover:text-accent-bright">
              Track order
            </a>
            <a href="/sell" className="text-cream-dim transition-colors hover:text-accent-bright">
              Sell with us
            </a>
            <a href="/contact" className="text-cream-dim transition-colors hover:text-accent-bright">
              Help &amp; support
            </a>
          </nav>
        </div>
      </div>

      {/* Wordmark, search, account */}
      <div className="bg-primary">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4">
          <a href="/" aria-label="Rare Minting home" className="shrink-0">
            <Wordmark size={compact ? 'sm' : 'md'} />
          </a>

          {/* A GET form, so a search is a URL somebody can share or go back to. */}
          <form
            action="/browse"
            method="get"
            role="search"
            className="order-3 flex min-w-0 flex-1 items-stretch md:order-none"
          >
            <label htmlFor="scope" className="sr-only">
              Category to search
            </label>
            <select
              id="scope"
              name="kind"
              defaultValue=""
              className="hidden shrink-0 rounded-l-sm border border-r-0 border-line bg-ink/60 px-3 text-sm text-cream-dim outline-none focus-visible:border-accent sm:block"
            >
              {SEARCH_SCOPES.map((s) => (
                <option key={s.label} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <label htmlFor="q" className="sr-only">
              Search
            </label>
            <input
              id="q"
              name="q"
              type="search"
              placeholder="Search by serial, note, coin or stone…"
              className="min-w-0 flex-1 rounded-l-sm border border-line bg-ink/60 px-4 py-2.5 text-sm text-cream placeholder:text-cream-dim/60 outline-none focus-visible:border-accent sm:rounded-l-none"
            />
            <button
              type="submit"
              aria-label="Search"
              className="shrink-0 rounded-r-sm bg-accent px-5 text-ink transition-colors hover:bg-accent-bright"
            >
              <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" aria-hidden>
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="m13.5 13.5 3.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-6">
            {user !== null && (
              <a href="/saved" className={action}>
                <span className="relative">
                  <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden>
                    <path
                      d="M10 16.5s-6-3.9-6-8a3.4 3.4 0 0 1 6-2.2A3.4 3.4 0 0 1 16 8.5c0 4.1-6 8-6 8Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <Badge n={savedCount} />
                </span>
                <span className="hidden lg:inline">Wishlist</span>
              </a>
            )}

            <a
              href="/cart"
              className={action}
              aria-label={`Cart, ${cartCount === 0 ? 'empty' : `${cartCount} item${cartCount === 1 ? '' : 's'}`}`}
            >
              <span className="relative">
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden>
                  <path
                    d="M3 3h2l1.6 8.4a1.5 1.5 0 0 0 1.5 1.2h6.3a1.5 1.5 0 0 0 1.5-1.2L17 6H6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="8.5" cy="16" r="1.2" fill="currentColor" />
                  <circle cx="14.5" cy="16" r="1.2" fill="currentColor" />
                </svg>
                <Badge n={cartCount} />
              </span>
              <span className="hidden lg:inline">Cart</span>
            </a>

            {user === null ? (
              <div className="flex items-center gap-2">
                <a
                  href="/signin"
                  className="rounded-full border border-cream/25 px-4 py-2 text-sm text-cream transition-colors hover:border-accent hover:text-accent-bright"
                >
                  Login
                </a>
                <a
                  href="/signup"
                  className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-bright"
                >
                  Register
                </a>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <a href="/account" className={action}>
                  <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden>
                    <circle cx="10" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.5" />
                    <path
                      d="M4 17a6 6 0 0 1 12 0"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="hidden max-w-[9rem] truncate lg:inline">
                    {user.fullName ?? user.email.split('@')[0]}
                  </span>
                </a>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="text-sm text-cream-dim underline-offset-4 transition-colors hover:text-accent-bright hover:underline"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Category rail */}
      <div className="border-t border-line/40 bg-secondary">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <a
            href="/browse"
            className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-accent-bright"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden>
              <path
                d="M3 5h14M3 10h14M3 15h14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            Browse all
          </a>

          <nav
            aria-label="Categories"
            className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em]"
          >
            <a href="/" className="text-cream transition-colors hover:text-accent-bright">
              Home
            </a>
            {CATEGORIES.map((c) => (
              <a
                key={c.href}
                href={c.href}
                className="text-cream-dim transition-colors hover:text-accent-bright"
              >
                {c.label}
              </a>
            ))}
            <a href="/about" className="text-cream-dim transition-colors hover:text-accent-bright">
              About us
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {isSeller && (
              <a
                href="/seller"
                className="rounded-full border border-accent/50 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-bright transition-colors hover:bg-accent hover:text-ink"
              >
                Dashboard
              </a>
            )}
            {isAdmin && (
              <a
                href="/admin"
                className="rounded-full border border-accent/50 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-bright transition-colors hover:bg-accent hover:text-ink"
              >
                Admin
              </a>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
