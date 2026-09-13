import type { MenuSection } from '@/components/DashboardShell.tsx';

/**
 * One dashboard, for everybody.
 *
 * There were two menus — a buyer's and a seller's — on separate route trees,
 * with a helper that picked between them for the few pages both roles reach.
 * That split was never in the data: a `users` row has always been one account
 * and `sellers` is an optional profile hanging off it. It existed only in the
 * navigation, and its effect was that somebody who both bought and sold had
 * two dashboards and no way to see their purchases beside their sales.
 *
 * So this builds the single menu, and `buyerMenu` and `sellerMenu` are now
 * both thin wrappers around it. Doing it that way rather than editing
 * nineteen pages means every page gets the same menu at once, and none of
 * them had to learn anything new.
 *
 * Badges are best-effort by design. A page that already loaded the seller
 * dashboard can fill in the selling counts; one that loaded the buyer counts
 * fills in those. Neither fetches the other half just to decorate a menu — a
 * missing number is a much smaller problem than a slower page, and the item
 * itself is always there either way.
 */

export interface MenuCounts {
  /** Buying side. */
  orders?: number | undefined;
  cart?: number | undefined;
  saved?: number | undefined;
  /** Selling side. */
  listings?: number | undefined;
  returns?: number | undefined;
  reviews?: number | undefined;
}

/**
 * Build the menu.
 *
 * `isSeller` decides how the selling section reads, not whether it appears.
 * Somebody who has never sold gets one invitation to start; listing all seven
 * seller pages to them would be seven dead ends, each sending them to the
 * same registration form.
 */
export function unifiedMenu({
  isSeller,
  counts = {},
}: {
  isSeller: boolean;
  counts?: MenuCounts;
}): MenuSection[] {
  return [
    {
      title: 'Buying',
      items: [
        { href: '/account', label: 'My dashboard' },
        { href: '/orders', label: 'My orders', badge: counts.orders },
        { href: '/cart', label: 'Cart', badge: counts.cart },
        { href: '/saved', label: 'Wishlist', badge: counts.saved },
        { href: '/browse', label: 'Find a date' },
        { href: '/auctions', label: 'Auctions' },
      ],
    },
    {
      title: 'Selling',
      items: isSeller
        ? [
            { href: '/seller', label: 'Sales overview' },
            { href: '/sell', label: 'Add a listing' },
            { href: '/seller/items', label: 'My listings', badge: counts.listings },
            { href: '/seller/auctions', label: 'My auctions' },
            { href: '/seller/payouts', label: 'Earnings' },
            { href: '/seller/returns', label: 'Returns', badge: counts.returns },
            { href: '/seller/reviews', label: 'Reviews', badge: counts.reviews },
          ]
        : [{ href: '/sell', label: 'Start selling' }],
    },
    {
      title: 'Account',
      items: [
        ...(isSeller ? [{ href: '/seller/profile', label: 'Store profile' }] : []),
        { href: '/support', label: 'Messages' },
        { href: '/contact', label: 'Help' },
        { href: '/refunds', label: 'Refunds' },
      ],
    },
  ];
}
