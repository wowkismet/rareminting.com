import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Promotions & banners',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Not built, and honest about it.
 *
 * There is no promotions table, no banner table and no discount code table.
 * The page says so, and says what each would actually need, because a console
 * full of controls that do nothing is worse than one page that admits a gap.
 */
export default async function AdminPromotionsPage() {
  const { user, sections } = await loadAdmin();

  const missing = [
    {
      name: 'Homepage banners',
      needs: 'A banners table, an image upload, and a slot on the homepage that reads from it.',
      note: 'The homepage sections are currently written in the page itself, so changing one is a deployment.',
    },
    {
      name: 'Discount codes',
      needs: 'A codes table, redemption tracking, and a decision about who absorbs the discount.',
      note: 'That last part is the real question: a code that comes out of the seller’s share without their agreement is a way to lose sellers.',
    },
    {
      name: 'Featured listings',
      needs: 'A flag on listings, plus a rule for who may set it and whether it is paid placement.',
      note: 'If it is ever sold rather than curated, it has to be labelled as advertising.',
    },
  ];

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Promotions & banners"
      subtitle="Not built yet"
      sections={sections}
      current="/admin/promotions"
    >
      <div className="flex flex-col gap-6">
        <Panel title="What this would need">
          <dl className="flex flex-col gap-5 text-sm">
            {missing.map((m) => (
              <div key={m.name} className="border-b border-sand-line pb-4 last:border-0 last:pb-0">
                <dt className="text-slate">{m.name}</dt>
                <dd className="mt-1 text-slate-dim">{m.needs}</dd>
                <dd className="mt-1 text-xs leading-relaxed text-slate-dim">{m.note}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          Nothing here is wired to anything. Rather than show buttons that quietly do nothing, this
          page names what each feature would need — including the two questions that are commercial
          rather than technical: who pays for a discount, and whether featured placement is curated
          or sold.
        </p>
      </div>
    </DashboardShell>
  );
}
