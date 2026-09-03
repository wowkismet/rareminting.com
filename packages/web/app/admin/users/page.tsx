import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Users',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface AdminUser {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  emailVerified: boolean;
  mobile: string | null;
  roles: string[];
  orders: number;
  isSeller: boolean;
  createdAt: string;
}

/**
 * The account list.
 *
 * Read-only. Suspending or deleting an account is not offered here because
 * neither is reversible from a table with a button on every row, and the
 * consequences of a mis-click land on a real person's access to money they are
 * owed.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { user, token, sections } = await loadAdmin();

  const query = typeof q === 'string' && q.trim() !== '' ? q.trim() : null;
  const result = await api<{ users: AdminUser[] }>(
    query === null ? '/v1/admin/users' : `/v1/admin/users?q=${encodeURIComponent(query)}`,
    { token },
  );
  const users = result.ok ? result.data.users : [];

  const sellers = users.filter((u) => u.isSeller).length;
  const verified = users.filter((u) => u.emailVerified).length;
  const admins = users.filter((u) => u.roles.includes('admin')).length;

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Users"
      subtitle={
        query === null
          ? `${users.length} account${users.length === 1 ? '' : 's'}`
          : `${users.length} matching “${query}”`
      }
      sections={sections}
      current="/admin/users"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Accounts" value={String(users.length)} accent />
          <StatCard label="Also sellers" value={String(sellers)} />
          <StatCard label="Email verified" value={String(verified)} />
          <StatCard label="Staff" value={String(admins)} />
        </div>

        <Panel title="Accounts">
          <form method="get" className="mb-4 flex flex-wrap gap-2">
            <input
              type="search"
              name="q"
              defaultValue={query ?? ''}
              placeholder="Search by name or email"
              className="min-w-0 flex-1 rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
            />
            <button
              type="submit"
              className="rounded-full bg-primary px-5 py-2 text-xs text-cream transition-colors hover:bg-secondary"
            >
              Search
            </button>
            {query !== null && (
              <a
                href="/admin/users"
                className="rounded-full border border-sand-line px-5 py-2 text-xs text-slate-dim"
              >
                Clear
              </a>
            )}
          </form>

          {users.length === 0 ? (
            <p className="text-sm text-slate-dim">
              {query === null ? 'No accounts yet.' : 'Nobody matches that search.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                    <th className="border-b border-sand-line p-3">Account</th>
                    <th className="border-b border-sand-line p-3">Mobile</th>
                    <th className="border-b border-sand-line p-3">Orders</th>
                    <th className="border-b border-sand-line p-3">Roles</th>
                    <th className="border-b border-sand-line p-3">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="border-b border-sand-line p-3">
                        <span className="block text-slate">{u.fullName ?? '—'}</span>
                        <span className="block text-xs text-slate-dim">{u.email}</span>
                        {!u.emailVerified && (
                          <span className="text-[10px] uppercase tracking-wider text-ember">
                            email unverified
                          </span>
                        )}
                      </td>
                      <td className="border-b border-sand-line p-3 font-mono text-xs text-slate-dim">
                        {u.mobile ?? '—'}
                      </td>
                      <td className="border-b border-sand-line p-3 tabular-nums text-slate-dim">
                        {u.orders}
                      </td>
                      <td className="border-b border-sand-line p-3 text-xs text-slate-dim">
                        {u.isSeller && (
                          <span className="mr-1 rounded-full border border-accent-deep/40 px-2 py-0.5 text-accent-deep">
                            seller
                          </span>
                        )}
                        {u.roles.map((r) => (
                          <span
                            key={r}
                            className="mr-1 rounded-full border border-sand-line px-2 py-0.5"
                          >
                            {r}
                          </span>
                        ))}
                        {!u.isSeller && u.roles.length === 0 && 'buyer'}
                      </td>
                      <td className="border-b border-sand-line p-3 text-xs text-slate-dim">
                        {u.createdAt.slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </DashboardShell>
  );
}
