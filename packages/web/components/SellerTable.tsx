import { setKycState } from '@/app/actions.ts';

export interface AdminSeller {
  id: string;
  displayName: string;
  kind: string;
  kycState: string;
  mintingVerified: boolean;
  email: string;
  emailVerified: boolean;
  mobile: string | null;
  mobileVerified: boolean;
  /** Last four characters only. The numbers themselves are not stored. */
  panLast4: string | null;
  panNameAgrees: boolean | null;
  aadhaarMasked: string | null;
  listingCount: number;
  createdAt: string;
}

/**
 * The seller table, with the two decisions an admin actually makes.
 *
 * Shared between the full seller list and the KYC queue, which is the same
 * table narrowed to those still waiting — so a change to how identity is
 * displayed cannot apply to one and not the other.
 */
export function SellerTable({
  sellers,
  emptyMessage,
}: {
  sellers: AdminSeller[];
  emptyMessage: string;
}) {
  if (sellers.length === 0) {
    return <p className="text-sm text-slate-dim">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
            <th className="border-b border-sand-line p-3">Seller</th>
            <th className="border-b border-sand-line p-3">Contact</th>
            <th className="border-b border-sand-line p-3">Identity</th>
            <th className="border-b border-sand-line p-3">Listings</th>
            <th className="border-b border-sand-line p-3">KYC</th>
            <th className="border-b border-sand-line p-3">Decide</th>
          </tr>
        </thead>
        <tbody>
          {sellers.map((s) => (
            <tr key={s.id}>
              <td className="border-b border-sand-line p-3 text-slate">
                {s.displayName}
                {s.mintingVerified && (
                  <span className="ml-2 rounded-full border border-accent-deep/40 px-2 py-0.5 text-[10px] text-accent-deep">
                    Verified
                  </span>
                )}
              </td>
              <td className="border-b border-sand-line p-3 text-slate-dim">
                <span className="block">{s.email}</span>
                {!s.emailVerified && (
                  <span className="text-[10px] uppercase tracking-wider text-ember">
                    email unverified
                  </span>
                )}
                <span className="mt-1 block font-mono text-xs">{s.mobile ?? '—'}</span>
                {s.mobile !== null && !s.mobileVerified && (
                  <span className="text-[10px] uppercase tracking-wider text-ember">
                    mobile unverified
                  </span>
                )}
              </td>
              <td className="border-b border-sand-line p-3 text-slate-dim">
                {/* Last four only — the numbers themselves are not stored. */}
                <span className="block font-mono text-xs">PAN ·····{s.panLast4 ?? '—'}</span>
                <span className="mt-1 block font-mono text-xs">
                  {s.aadhaarMasked ?? 'Aadhaar —'}
                </span>
                {s.panNameAgrees === false && (
                  <span className="text-[10px] uppercase tracking-wider text-ember">
                    name ≠ PAN initial
                  </span>
                )}
              </td>
              <td className="border-b border-sand-line p-3 tabular-nums text-slate-dim">
                {s.listingCount}
              </td>
              <td className="border-b border-sand-line p-3 text-slate-dim">{s.kycState}</td>
              <td className="border-b border-sand-line p-3">
                <div className="flex gap-2">
                  <form action={setKycState}>
                    <input type="hidden" name="sellerId" value={s.id} />
                    <input type="hidden" name="kycState" value="verified" />
                    <button
                      type="submit"
                      className="rounded-full bg-primary px-3 py-1 text-xs text-cream transition-colors hover:bg-secondary"
                    >
                      Verify
                    </button>
                  </form>
                  <form action={setKycState}>
                    <input type="hidden" name="sellerId" value={s.id} />
                    <input type="hidden" name="kycState" value="rejected" />
                    <input
                      type="hidden"
                      name="reason"
                      value="Documents did not satisfy verification."
                    />
                    <button
                      type="submit"
                      className="rounded-full border border-sand-line px-3 py-1 text-xs text-slate-dim transition-colors hover:border-ember hover:text-ember"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
