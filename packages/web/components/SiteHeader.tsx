import Image from 'next/image';

import { signOut } from '@/app/actions.ts';
import type { ApiUser } from '@/lib/api.ts';

/**
 * The masthead, with whatever the visitor can currently do.
 *
 * Signed out: sign in, or start selling. Signed in: their account.
 * `compact` is for interior pages, where the logo does not need to dominate.
 */
export function SiteHeader({
  user,
  compact = false,
}: {
  user: ApiUser | null;
  compact?: boolean;
}) {
  return (
    <div className="guilloche bg-primary">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5">
        <a href="/" aria-label="Rare Minting home" className="shrink-0">
          <Image
            src="/rare-minting-logo.png"
            alt="Rare Minting"
            width={2171}
            height={724}
            priority
            sizes={compact ? '200px' : '260px'}
            className={compact ? 'h-auto w-[190px]' : 'h-auto w-[230px]'}
          />
        </a>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <a className="text-cream-dim transition-colors hover:text-accent-bright" href="/browse">
            Browse
          </a>

          {user === null ? (
            <>
              <a className="text-cream-dim transition-colors hover:text-accent-bright" href="/signin">
                Sign in
              </a>
              <a
                className="rounded-full bg-accent px-5 py-2 font-medium text-ink transition-colors hover:bg-accent-bright"
                href="/signup"
              >
                Start selling
              </a>
            </>
          ) : (
            <>
              <a className="text-cream-dim transition-colors hover:text-accent-bright" href="/sell">
                Sell a note
              </a>
              <a className="text-cream-dim transition-colors hover:text-accent-bright" href="/account">
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
