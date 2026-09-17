'use client';

import { useState } from 'react';

/**
 * Hand the parcel to the courier.
 *
 * A client component because booking takes a few seconds of round trips to
 * Shiprocket and the seller needs to be told what happened — including, in the
 * common failure, that no courier serves the buyer's pin code, which is not
 * something a page reload communicates.
 *
 * Disabled the moment it is pressed. Booking twice is a second parcel, a
 * second charge, and a second tracking number the buyer was never given —
 * the API refuses it, but a button that invites the mistake is a bad button.
 */
export function ShipButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ awb: string; courierName: string | null } | null>(null);

  async function ship(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/orders/${orderId}/ship`, { method: 'POST' });
      const body = (await res.json()) as {
        awb?: string;
        courierName?: string | null;
        message?: string;
      };
      if (!res.ok) {
        setError(body.message ?? 'The parcel could not be booked. Nothing has been charged.');
        return;
      }
      setBooked({ awb: body.awb ?? '', courierName: body.courierName ?? null });
      // The order state and the tracking panel both change; the server
      // renders both, so the simplest correct thing is to ask it again.
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setError('Something went wrong booking the parcel. Nothing has been charged.');
    } finally {
      setBusy(false);
    }
  }

  if (booked !== null) {
    return (
      <p
        role="status"
        className="rounded-sm border border-accent-deep/50 bg-accent-deep/10 px-4 py-3 text-sm text-slate"
      >
        Booked with {booked.courierName ?? 'the courier'} — AWB{' '}
        <span className="font-mono">{booked.awb}</span>. Print the label from the invoice page.
      </p>
    );
  }

  return (
    <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
      <p className="font-display text-lg text-slate">Send it</p>
      <p className="mt-2 mb-4 text-sm leading-relaxed text-slate-dim">
        Pack the note first. This books a courier, gets a tracking number and asks for a pickup —
        so only press it once the parcel physically exists.
      </p>
      <button
        type="button"
        onClick={() => void ship()}
        disabled={busy}
        className="rounded-full bg-primary px-7 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Booking…' : 'Book the courier'}
      </button>

      {error !== null && (
        <p
          role="alert"
          className="mt-3 rounded-sm border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-slate"
        >
          {error}
        </p>
      )}
    </div>
  );
}
