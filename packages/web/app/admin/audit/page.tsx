import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Audit logs',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface AuditEntry {
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  email: string | null;
}

const ACTION: Record<string, string> = {
  'seller.kyc': 'Decided a seller’s verification',
  'listing.moderate': 'Moderated a listing',
  'payout.hold': 'Held a payout',
  'payout.transfer': 'Recorded a transfer',
  'payout.reveal': 'Revealed a bank account number',
};

/**
 * The trail.
 *
 * Append-only at the database level rather than by convention: a trigger
 * refuses updates and deletes, so nothing here can be tidied away afterwards,
 * including by whoever is reading this page.
 */
export default async function AdminAuditPage() {
  const { user, token, sections } = await loadAdmin();
  const result = await api<{ entries: AuditEntry[] }>('/v1/admin/audit', { token });
  const entries = result.ok ? result.data.entries : [];

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Audit logs"
      subtitle={`${entries.length} recorded action${entries.length === 1 ? '' : 's'}`}
      sections={sections}
      current="/admin/audit"
    >
      <div className="flex flex-col gap-6">
        <Panel title="Newest first">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-dim">
              Nothing recorded yet. Staff actions that change something — approving a seller,
              withdrawing a listing, revealing a bank account — appear here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                    <th className="border-b border-sand-line p-3">When</th>
                    <th className="border-b border-sand-line p-3">Who</th>
                    <th className="border-b border-sand-line p-3">Did what</th>
                    <th className="border-b border-sand-line p-3">To</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={`${e.created_at}-${i}`}>
                      <td className="border-b border-sand-line p-3 text-xs text-slate-dim">
                        {e.created_at.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="border-b border-sand-line p-3 text-xs text-slate">
                        {e.email ?? 'account since removed'}
                      </td>
                      <td className="border-b border-sand-line p-3 text-slate">
                        {ACTION[e.action] ?? e.action}
                      </td>
                      <td className="border-b border-sand-line p-3 font-mono text-[11px] text-slate-dim">
                        {e.entity_type}
                        {e.entity_id !== null && (
                          <span className="block">{e.entity_id.slice(0, 8)}…</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          This table is append-only at the database level, not by convention — a trigger refuses
          updates and deletes. Nothing here can be tidied away afterwards, including by whoever is
          reading this page. The actor is kept as a reference rather than a copy of their name, so
          an account can still be erased under the DPDP Act without destroying the record of what
          was done.
        </p>
      </div>
    </DashboardShell>
  );
}
