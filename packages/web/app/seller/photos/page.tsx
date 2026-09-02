import type { Metadata } from 'next';

import { DashboardShell, Empty } from '@/components/DashboardShell.tsx';
import { ItemRow } from '@/components/ItemRow.tsx';
import { loadSeller, sellerMenu } from '@/lib/seller-dashboard.ts';

export const metadata: Metadata = { title: 'Needs photographs' };
export const dynamic = 'force-dynamic';

/**
 * The items with no photograph.
 *
 * Its own page because it is the single most common reason a listing does not
 * sell, and a seller should be able to see the whole backlog at once.
 */
export default async function SellerPhotosPage() {
  const { user, data } = await loadSeller();
  const missing = data.listings.filter((l) => l.photoCount === 0);

  return (
    <DashboardShell
      user={user}
      eyebrow="The Mint"
      title="Needs photographs"
      subtitle={
        missing.length === 0
          ? 'Every item has at least one photograph'
          : `${missing.length} of ${data.listings.length} items have none`
      }
      sections={sellerMenu(data)}
      current="/seller/photos"
    >
      {missing.length === 0 ? (
        <Empty action={{ href: '/seller/items', label: 'See all items' }}>
          Every one of your items has a photograph. That is the single biggest thing you can do to
          make a note sell.
        </Empty>
      ) : (
        <>
          <p className="mb-6 rounded-sm border border-accent-deep/40 bg-accent-deep/5 p-5 text-sm leading-relaxed text-slate-dim">
            Buyers decide on the picture. Photograph the note flat, in daylight, with the serial
            legible — open an item below and the upload form is at the top of its page.
          </p>
          <ul className="flex flex-col gap-3">
            {missing.map((l) => (
              <ItemRow key={l.id} listing={l} canPublish={data.seller.approved} />
            ))}
          </ul>
        </>
      )}
    </DashboardShell>
  );
}
