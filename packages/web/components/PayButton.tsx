'use client';

import { useState } from 'react';

/**
 * The pay button.
 *
 * A client component because Cashfree's checkout is a script that takes over
 * the page — there is no server-rendered form that can do it.
 *
 * The flow: ask our API to start a payment, hand the session it returns to
 * Cashfree's SDK, and let Cashfree redirect the browser away. It comes back to
 * the order page, which asks Cashfree directly what happened before it says
 * anything to the buyer. Nothing the browser reports is treated as payment —
 * under this flow it is not even asked, because the redirect back carries an
 * order id and nothing else.
 */

interface StartResponse {
  provider: string;
  gatewayOrderId: string;
  paymentSessionId: string;
  amountPaise: number;
  currency: string;
  orderNumber: string;
  mode: 'sandbox' | 'production';
  isTest: boolean;
}

interface CashfreeCheckout {
  checkout: (options: {
    paymentSessionId: string;
    redirectTarget?: string;
  }) => Promise<{ error?: { message?: string } } | void>;
}

// The checkout script attaches itself to window.
declare global {
  interface Window {
    Cashfree?: ((options: { mode: string }) => CashfreeCheckout) & {
      new (options: { mode: string }): CashfreeCheckout;
    };
  }
}

const SCRIPT = 'https://sdk.cashfree.com/js/v3/cashfree.js';

function loadCheckout(): Promise<void> {
  if (window.Cashfree !== undefined) return Promise.resolve();
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

/**
 * Cashfree's SDK has shipped both as a plain factory and as a constructor.
 * Try it as a factory first and fall back, rather than pinning this integration
 * to whichever form the CDN is serving this month.
 */
function initialise(mode: string): CashfreeCheckout {
  const factory = window.Cashfree;
  if (factory === undefined) throw new Error('SDK missing');
  try {
    return factory({ mode });
  } catch {
    return new factory({ mode });
  }
}

export function PayButton({
  orderId,
  groupId,
  amountInr,
  label = 'Pay now',
}: {
  /** One order. Give this or groupId, not both. */
  orderId?: string;
  /** A whole basket, paid for once. */
  groupId?: string;
  amountInr: number;
  label?: string;
}) {
  // A basket and a single order are the same transaction from the buyer's
  // side; only the endpoint differs.
  const startPath = groupId === undefined ? `/pay/${orderId}/start` : `/pay/group/${groupId}/start`;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const started = await fetch(startPath, { method: 'POST' });
      const body = (await started.json()) as StartResponse & { message?: string };

      if (!started.ok) {
        setError(body.message ?? 'We could not start this payment. Please try again.');
        return;
      }

      await loadCheckout();
      if (window.Cashfree === undefined) {
        setError('The payment window could not be loaded. Check your connection and try again.');
        return;
      }

      const result = await initialise(body.mode).checkout({
        paymentSessionId: body.paymentSessionId,
        // Take over the whole page rather than opening a modal. Cashfree then
        // returns the buyer to the order page, which is the one place that
        // checks with the gateway before saying anything about their money.
        redirectTarget: '_self',
      });

      // Reached only when the SDK refused before navigating; a successful
      // checkout has already taken the page away by now.
      if (result !== undefined && result !== null && 'error' in result && result.error) {
        setError(
          result.error.message ?? 'The payment could not be started. Nothing was charged.',
        );
        return;
      }

      setMessage('Taking you to the payment page…');
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
        aria-label={label}
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
