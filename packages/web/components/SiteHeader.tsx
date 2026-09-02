import { signOut } from '@/app/actions.ts';
import type { ApiUser } from '@/lib/api.ts';
import { Wordmark } from './Wordmark.tsx';

/**
 * The masthead and primary navigation.
 *
 * Flat brand green, deliberately. The guilloche pattern belongs on the panels
 * that are meant to look like a banknote; behind a logo and a row of links it
 * competes with both and makes the wordmark harder to read.
 *
 * Every link here goes to a page that exists. "Admin" appears only for staff —
 * not hidden as a security measure (the API is the boundary) but because a
 * console a buyer cannot open should not be advertised to them.
 */

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About us' },
  { href: '/auctions', label: 'Auctions' },
  { href: '/browse', label: 'Buy now' },
  { href: '/sell', label: 'Sell now' },
] as const;

export function SiteHeader({
  user,
  compact = false,
}: {
  user: ApiUser | null;
  compact?: boolean;
}) {
  const isAdmin = user?.roles.includes('admin') ?? false;
  const isSeller = user?.roles.includes('seller') ?? false;

  return (
    <div className="bg-primary">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5">
        <a href="/" aria-label="Rare Minting home" className="shrink-0">
          <Wordmark size={compact ? 'sm' : 'md'} />
        </a>

        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-cream-dim transition-colors hover:text-accent-bright"
            >
              {link.label}
            </a>
          ))}

          {isSeller && (
            <a
              href="/seller"
              className="rounded-full border border-accent/50 px-3 py-1 text-xs text-accent-bright transition-colors hover:bg-accent hover:text-ink"
            >
              Dashboard
            </a>
          )}

          {isAdmin && (
            <a
              href="/admin"
              className="rounded-full border border-accent/50 px-3 py-1 text-xs text-accent-bright transition-colors hover:bg-accent hover:text-ink"
            >
              Admin
            </a>
          )}

          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />

          {user === null ? (
            <>
              <a
                className="text-cream-dim transition-colors hover:text-accent-bright"
                href="/signin"
              >
                Sign in
              </a>
              <a
                className="rounded-full bg-accent px-5 py-2 font-medium text-ink transition-colors hover:bg-accent-bright"
                href="/signup"
              >
                Create account
              </a>
            </>
          ) : (
            <>
              <a
                className="text-cream-dim transition-colors hover:text-accent-bright"
                href="/orders"
              >
                Orders
              </a>
              <a
                className="text-cream-dim transition-colors hover:text-accent-bright"
                href="/account"
              >
                {user.fullName ?? user.email.split('@')[0]}
              </a>
              <form action={signOut}>
                <button
                  type="submit"
                  className="text-cream-dim underline-offset-4 transition-colors hover:text-accent-bright hover:underline"
                >
                  Sign out
                </button>
              </form>
            </>
          )}
        </nav>
      </div>
    </div>
  );
}
