import { Barcode } from '@/components/Barcode.tsx';

export interface TrackingData {
  booked: boolean;
  awb?: string;
  courierName?: string | null;
  status?: string | null;
  deliveredAt?: string | null;
  live?: boolean;
  events: { at: string; status: string; location: string | null }[];
}

const when = (raw: string): string => {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Where the parcel is.
 *
 * The same component for the buyer, the seller and staff, because the answer
 * to "where is it" is the same answer for all three and a support call goes
 * badly when two people are looking at different versions of it.
 *
 * Shows the AWB even when the courier cannot be reached. The number on its own
 * is useful — it can be pasted into the courier's own tracking page — and
 * "we cannot reach the courier" is a more honest thing to display than an
 * empty panel that looks like nothing has shipped.
 *
 * Newest event first, which is the one being looked for.
 */
export function Tracking({ tracking }: { tracking: TrackingData }) {
  if (!tracking.booked) {
    return (
      <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">Delivery</p>
        <p className="mt-2 text-sm text-slate-dim">
          Not yet handed to a courier. A tracking number appears here the moment it is.
        </p>
      </div>
    );
  }

  const events = [...tracking.events].reverse();

  return (
    <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
            Delivery
            {tracking.courierName !== null && tracking.courierName !== undefined && (
              <span> · {tracking.courierName}</span>
            )}
          </p>
          <p className="mt-2 font-mono text-sm text-slate">{tracking.awb}</p>
          {tracking.status !== null && tracking.status !== undefined && (
            <p className="mt-1 text-sm text-accent-deep">{tracking.status}</p>
          )}
          {tracking.deliveredAt !== null && tracking.deliveredAt !== undefined && (
            <p className="mt-1 text-xs text-slate-dim">Delivered {when(tracking.deliveredAt)}</p>
          )}
        </div>

        {/* Scannable from the screen as well as from paper — a packer with a
            handheld often has the order open rather than the label printed. */}
        {tracking.awb !== undefined && (
          <Barcode value={tracking.awb} height={40} moduleWidth={1.5} showText={false} />
        )}
      </div>

      {tracking.live === false && (
        <p className="mt-3 rounded-sm border border-sand-line px-3 py-2 text-xs text-slate-dim">
          The courier could not be reached just now, so this is the last we heard. The number above
          works on the courier&rsquo;s own tracking page.
        </p>
      )}

      {events.length > 0 && (
        <ol className="mt-4 flex flex-col gap-3 border-t border-sand-line pt-4">
          {events.map((event, i) => (
            <li key={`${event.at}-${i}`} className="flex gap-3 text-sm">
              <span
                aria-hidden
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  i === 0 ? 'bg-accent-deep' : 'bg-sand-line'
                }`}
              />
              <span className="min-w-0">
                <span className="block text-slate">{event.status}</span>
                <span className="block text-xs text-slate-dim">
                  {when(event.at)}
                  {event.location !== null && event.location !== '' && ` · ${event.location}`}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
