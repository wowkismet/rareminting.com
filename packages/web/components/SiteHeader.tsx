import { signOut } from '@/app/actions.ts';
import { api, type ApiUser } from '@/lib/api.ts';
import { sessionToken } from '@/lib/session.ts';
import { Wordmark } from './Wordmark.tsx';

/**
 * The masthead and primary navigation.
 *
 * Flat brand green, deliberately. The guilloche pattern belongs on the panels
 * meant to look like a banknote; behind a logo and a row of links it competes
 * with both and makes the wordmark harder to read.
 *
 * Every link goes to a page that exists. "Admin" appears only for staff — not
 * as a security measure, since the API is the boundary, but because a console
 * a buyer cannot open should not be advertised to them.
 *
 * The cart count is fetched rather than passed in, so it is right on every
 * page without each one having to remember to look it up. It costs one query
 * for a signed-in visitor and nothing at all for anybody else.
 */

// Collections and Resources are deliberately not here. Collections has its own
// band on the homepage, and the policies live in the footer, which carries all
// four under their own heading.
const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/browse', label: 'Browse' },
  { href: '/auctions', label: 'Auctions' },
  { href: '/sell', label: 'Sell' },
] as const;

/** A count on an icon, shown only when there is something to count. */
function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] tabular-nums text-ink">
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

  // Only a signed-in visitor has a basket to count.
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

  const iconLink =
    'relative flex h-9 w-9 items-center justify-center rounded-full text-cream-dim transition-colors hover:bg-cream/10 hover:text-accent-bright';

  return (
    <div className="bg-primary">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <a href="/" aria-label="Rare Minting home" className="shrink-0">
          <Wordmark size={compact ? 'sm' : 'md'} />
        </a>

        <nav
          aria-label="Main"
          className="order-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm md:order-none md:flex-1"
        >
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-cream-dim transition-colors hover:text-accent-bright"
            >
              {link.label}
            </a>
          ))}

          <a
            href="/about"
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-cream-dim transition-colors hover:text-accent-bright"
          >
            About us
          </a>
        </nav>

        {/* Everything a visitor acts with, gathered on the right. */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <a href="/browse" aria-label="Search notes" title="Search" className={iconLink}>
            <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" aria-hidden>
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
              <path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </a>

          {user !== null && (
            <a
              href="/saved"
              aria-label={`Saved items${savedCount > 0 ? `, ${savedCount}` : ''}`}
              title="Saved"
              className={iconLink}
            >
              <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" aria-hidden>
                <path
                  d="M10 16.5s-6-3.9-6-8a3.4 3.4 0 0 1 6-2.2A3.4 3.4 0 0 1 16 8.5c0 4.1-6 8-6 8Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              <Badge n={savedCount} />
            </a>
          )}

          <a
            href="/cart"
            aria-label={`Cart${cartCount > 0 ? `, ${cartCount} item${cartCount === 1 ? '' : 's'}` : ', empty'}`}
            title="Cart"
            className={iconLink}
          >
            <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" aria-hidden>
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
          </a>

          {isSeller && (
            <a
              href="/seller"
              className="ml-1 rounded-full border border-accent/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-bright transition-colors hover:bg-accent hover:text-ink"
            >
              Dashboard
            </a>
          )}

          {isAdmin && (
            <a
              href="/admin"
              className="rounded-full border border-accent/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-bright transition-colors hover:bg-accent hover:text-ink"
            >
              Admin
            </a>
          )}

          {user === null ? (
            <>
              <a
                href="/signin"
                className="ml-1 rounded-full border border-cream/25 px-5 py-2 text-sm text-cream transition-colors hover:border-accent hover:text-accent-bright"
              >
                Login
              </a>
              <a
                href="/signup"
                className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-bright"
              >
                Register
              </a>
            </>
          ) : (
            <>
              <a
                href="/account"
                className="ml-1 max-w-[10rem] truncate text-sm text-cream-dim transition-colors hover:text-accent-bright"
              >
                {user.fullName ?? user.email.split('@')[0]}
              </a>
              <form action={signOut}>
                <button
                  type="submit"
                  className="text-sm text-cream-dim underline-offset-4 transition-colors hover:text-accent-bright hover:underline"
                >
                  Sign out
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
