import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Backup & security',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * What protects this site, and what does not yet.
 *
 * No uptime figure and no "last backup" timestamp: the web app cannot see the
 * host's backup schedule or its own uptime, so both would be decorative. What
 * it can do is state accurately what the code guarantees, and name the gaps.
 */
export default async function AdminBackupPage() {
  const { user, sections } = await loadAdmin();

  const inPlace = [
    {
      name: 'Identity numbers are not stored',
      detail:
        'PAN and Aadhaar become a keyed one-way fingerprint plus the last four characters at registration. A database leak exposes neither, and no route returns them — including to an admin.',
    },
    {
      name: 'Bank accounts are encrypted at rest',
      detail:
        'AES-256-GCM under a key held in the server environment, never in the database. Revealing a number in the transfer queue is written to the audit trail.',
    },
    {
      name: 'The audit trail cannot be edited',
      detail:
        'Append-only enforced by a database trigger, not by application code, so nothing can be tidied away afterwards — including by staff.',
    },
    {
      name: 'Releases roll back without a rebuild',
      detail:
        'Each deploy is a timestamped directory and current is a symlink, so reverting is re-pointing it and restarting. The five most recent are kept.',
    },
  ];

  const gaps = [
    {
      name: 'Database backups are the host’s, not the application’s',
      detail:
        'Whatever schedule is set in the VPS panel is what exists. Nothing in this codebase takes, verifies or restores a dump, so a backup nobody has ever restored from is the real risk here.',
    },
    {
      name: 'SSH still accepts a root password',
      detail:
        'A standing brute-force target. Turning it off is two lines in sshd_config, but only after a key login is proven to work — otherwise the browser terminal is the only way back in.',
    },
    {
      name: 'No alerting',
      detail:
        'If the API stops, nothing tells anybody. The deploy script smoke-tests both services and refuses to leave a broken release running, but that only covers the moment of deploy.',
    },
  ];

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Backup & security"
      subtitle="What is guaranteed, and what is not"
      sections={sections}
      current="/admin/backup"
    >
      <div className="flex flex-col gap-6">
        <Panel title="In place">
          <dl className="flex flex-col gap-4 text-sm">
            {inPlace.map((i) => (
              <div key={i.name}>
                <dt className="text-slate">{i.name}</dt>
                <dd className="mt-1 leading-relaxed text-slate-dim">{i.detail}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="Gaps worth closing">
          <dl className="flex flex-col gap-4 text-sm">
            {gaps.map((g) => (
              <div key={g.name}>
                <dt className="text-ember">{g.name}</dt>
                <dd className="mt-1 leading-relaxed text-slate-dim">{g.detail}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          Deliberately absent: an uptime percentage and a &ldquo;last backup&rdquo; timestamp. This
          application cannot see the host&rsquo;s backup schedule or measure its own uptime, so both
          figures would be decoration — and a reassuring green tick nobody verified is worse than no
          tick at all.
        </p>
      </div>
    </DashboardShell>
  );
}
