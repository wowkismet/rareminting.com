import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'System settings',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Where the settings actually are.
 *
 * There is no settings table, and this page does not pretend otherwise. What
 * it does instead is say truthfully where each thing is configured, because an
 * admin hunting for the commission rate is better served by being told it
 * lives in code and the database than by a toggle that silently does nothing.
 */
export default async function AdminSettingsPage() {
  const { user, sections } = await loadAdmin();

  const settings = [
    {
      name: 'Commission, GST and TDS',
      where: 'packages/api/src/money.ts, and the commission_rules table',
      detail:
        'Commission is 20% of the sale price. GST on that commission and TDS under section 194-O are computed in basis points, never in floating point. A rate change must not rewrite what past orders were charged, which is why each order stores the figures it was charged rather than a rate to reapply.',
    },
    {
      name: 'Payment gateway keys',
      where: '/etc/rareminting.env on the server',
      detail:
        'Read from the environment at start-up and never through the web. They are deliberately not editable here: a console that can change where money settles is a console worth stealing.',
    },
    {
      name: 'Identity pepper and bank encryption key',
      where: '/etc/rareminting.env on the server',
      detail:
        'KYC_NUMBER_PEPPER keys the one-way fingerprint that replaces a PAN or Aadhaar; BANK_DETAILS_KEY encrypts stored account numbers. Rotating either is a migration, not a form field — every existing fingerprint would stop matching.',
    },
    {
      name: 'Categories and pattern tags',
      where: 'Seeded by database migration',
      detail:
        'Adding one is a migration so that every environment agrees on what exists. See the categories page for what is currently defined.',
    },
  ];

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="System settings"
      subtitle="What is configurable, and where"
      sections={sections}
      current="/admin/settings"
    >
      <div className="flex flex-col gap-6">
        <Panel title="Configuration">
          <dl className="flex flex-col gap-5 text-sm">
            {settings.map((s) => (
              <div key={s.name} className="border-b border-sand-line pb-4 last:border-0 last:pb-0">
                <dt className="text-slate">{s.name}</dt>
                <dd className="mt-1 font-mono text-[11px] text-accent-deep">{s.where}</dd>
                <dd className="mt-2 leading-relaxed text-slate-dim">{s.detail}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          There is no settings table, so this page reads rather than edits. That is a deliberate
          position rather than unfinished work: the things worth configuring here are the ones where
          a mis-click moves money or breaks stored identity data, and each is safer as a deployment
          than as a button.
        </p>
      </div>
    </DashboardShell>
  );
}
