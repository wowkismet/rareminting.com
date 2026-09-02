'use client';

import { useState } from 'react';

/**
 * The pay button.
 *
 * A client component because Razorpay's checkout is a script that opens a modal
 * over the page — there is no server-rendered form that can do it.
 *
 * The flow: ask our API to start a payment, open Razorpay with what it returns,
 * and report the result back. That report is a courtesy, not the record. The
 * order is marked paid by a webhook arriving at our server, which is why the
 * message afterwards says we are confirming rather than claiming it is done.
 */

interface StartResponse {
  keyId: string;
  gatewayOrderId: string;
  amountPaise: number;
  currency: string;
  orderNumber: string;
  isTest: boolean;
}

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

// The checkout script attaches itself to window.
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

function loadCheckout(): Promise<void> {
  if (window.Razorpay !== undefined) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT}"]`);
    if (existing !== null) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('script failed')));
      return;
    }
    const el = document.createElement('script');
    el.src = SCRIPT;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('script failed'));
    document.body.appendChild(el);
  });
}

export function PayButton({
  orderId,
  amountInr,
  buyerName,
  buyerEmail,
}: {
  orderId: string;
  amountInr: number;
  buyerName: string | null;
  buyerEmail: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const started = await fetch(`/pay/${orderId}/start`, { method: 'POST' });
      const body = (await started.json()) as StartResponse & { message?: string };

      if (!started.ok) {
        setError(body.message ?? 'We could not start this payment. Please try again.');
        return;
      }

      await loadCheckout();
      if (window.Razorpay === undefined) {
        setError('The payment window could not be loaded. Check your connection and try again.');
        return;
      }

      const checkout = new window.Razorpay({
        key: body.keyId,
        order_id: body.gatewayOrderId,
        amount: body.amountPaise,
        currency: body.currency,
        name: 'Rare Minting',
        description: `Order ${body.orderNumber}`,
        prefill: { name: buyerName ?? '', email: buyerEmail },
        theme: { color: '#1a4a2e' },
        handler: async (response: RazorpayResponse) => {
          await fetch('/pay/callback', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              gatewayOrderId: response.razorpay_order_id,
              gatewayPaymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            }),
          });
          setMessage(
            'Payment received. We are confirming it with the payment provider — this page updates within a moment.',
          );
          // The webhook does the real work; reload to pick it up.
          setTimeout(() => window.location.reload(), 4000);
        },
        modal: {
          ondismiss: () => {
            setBusy(false);
            setMessage('Payment cancelled. Your order is still here whenever you want to pay.');
          },
        },
      });

      checkout.open();
    } catch {
      setError('Something went wrong starting the payment. Nothing was charged.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy}
        className="rounded-full bg-primary px-8 py-3 text-sm font-medium text-cream transition-colors hover:bg-secondary disabled:opacity-60"
      >
        {busy ? 'Opening…' : `Pay ₹${amountInr.toLocaleString('en-IN')}`}
      </button>

      {error !== null && (
        <p
          role="alert"
          className="rounded-sm border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-slate"
        >
          {error}
        </p>
      )}
      {message !== null && (
        <p
          role="status"
          className="rounded-sm border border-accent-deep/50 bg-accent-deep/10 px-4 py-3 text-sm text-slate"
        >
          {message}
        </p>
      )}
    </div>
  );
}
