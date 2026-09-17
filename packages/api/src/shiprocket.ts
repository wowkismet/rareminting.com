/**
 * Shiprocket, the delivery partner.
 *
 * Shaped like cashfree.ts on purpose — read the config or report the service
 * is off, never throw at a caller who can do nothing about it, and keep every
 * unit conversion in one place.
 *
 * Two things here are worth knowing before changing anything.
 *
 * The token. Shiprocket authenticates with the account's own email and
 * password rather than an API key, and hands back a JWT good for about ten
 * days. Logging in on every call would be slow and would eventually get the
 * account rate-limited, so the token is cached in memory and refreshed on a
 * 401. It is cached in memory and not on disk deliberately: a restart costing
 * one extra login is cheaper than a credential sitting in a file nobody
 * remembers writing.
 *
 * The weight. Shiprocket prices on volumetric weight and rejects a shipment
 * with none, so every parcel declares dimensions. A banknote in a rigid
 * sleeve is not 0.5 kg, but declaring less than the courier's own minimum
 * gets the shipment re-weighed at the hub and billed back at a penalty, which
 * is worse than declaring honestly. PARCEL is the smallest sane declaration.
 */

const BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

export interface ShiprocketConfig {
  readonly email: string;
  readonly password: string;
  /** The pickup address nickname configured in the Shiprocket dashboard. */
  readonly pickupLocation: string;
}

/**
 * Read the configuration, or report that shipping is not set up.
 *
 * Null rather than throwing, matching cashfreeConfig: orders can still be
 * taken and packed by hand without a courier integration, and every caller
 * has something sensible to say in that case.
 */
export function shiprocketConfig(): ShiprocketConfig | null {
  const email = process.env['SHIPROCKET_EMAIL'];
  const password = process.env['SHIPROCKET_PASSWORD'];
  if (email === undefined || email === '' || password === undefined || password === '') {
    return null;
  }
  return {
    email,
    password,
    // Must match a pickup nickname that exists in the dashboard; Shiprocket
    // rejects an order naming one it does not know.
    pickupLocation: process.env['SHIPROCKET_PICKUP_LOCATION'] ?? 'Primary',
  };
}

export class ShiprocketError extends Error {
  readonly status: number;
  /** Shiprocket's own message, kept for the log and for staff, never for a buyer. */
  readonly detail: string;

  constructor(message: string, status: number, detail = '') {
    super(message);
    this.name = 'ShiprocketError';
    this.status = status;
    this.detail = detail;
  }
}

/* ------------------------------ the token ------------------------------ */

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

let cached: CachedToken | null = null;

/** Drop the cached token. Exported so a test can start from a known state. */
export function forgetToken(): void {
  cached = null;
}

/**
 * A valid bearer token, logging in only when there isn't one.
 *
 * The expiry is held well short of Shiprocket's ten days. A token that
 * expires mid-request costs a retry; one refreshed a day early costs one
 * extra login a week.
 */
async function token(config: ShiprocketConfig): Promise<string> {
  if (cached !== null && cached.expiresAt > Date.now()) return cached.token;

  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });

  const text = await response.text();
  if (!response.ok) {
    // Never surface this to a buyer: a failed login returns the account email
    // and sometimes the reason, neither of which is theirs to see.
    console.error('[shiprocket] login failed:', response.status, text.slice(0, 300));
    throw new ShiprocketError('Could not reach the delivery partner.', 502, text.slice(0, 300));
  }

  let parsed: { token?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new ShiprocketError('The delivery partner returned something unreadable.', 502);
  }
  if (typeof parsed.token !== 'string' || parsed.token === '') {
    throw new ShiprocketError('The delivery partner did not return a token.', 502);
  }

  cached = { token: parsed.token, expiresAt: Date.now() + 8 * 24 * 60 * 60 * 1000 };
  return parsed.token;
}

/**
 * One authenticated call, retrying once through a fresh login on a 401.
 *
 * The retry matters: a token can be invalidated at Shiprocket's end — a
 * password change, a session revoked — and without this every subsequent
 * shipment fails until someone restarts the service.
 */
async function call<T>(
  config: ShiprocketConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
  { retrying = false }: { retrying?: boolean } = {},
): Promise<T> {
  const bearer = await token(config);
  const response = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  if (response.status === 401 && !retrying) {
    forgetToken();
    return call<T>(config, path, init, { retrying: true });
  }

  const text = await response.text();
  if (!response.ok) {
    console.error('[shiprocket]', init.method ?? 'GET', path, response.status, text.slice(0, 500));
    throw new ShiprocketError(
      'The delivery partner could not accept this shipment.',
      502,
      text.slice(0, 500),
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ShiprocketError('The delivery partner returned something unreadable.', 502);
  }
}

/* ------------------------------ shipments ------------------------------ */

/** A parcel, as this marketplace ships them. */
export interface Parcel {
  /** kg. Shiprocket refuses a shipment with no weight. */
  readonly weightKg: number;
  readonly lengthCm: number;
  readonly breadthCm: number;
  readonly heightCm: number;
}

/**
 * The smallest honest declaration for a note or coin in a rigid sleeve.
 *
 * Under-declaring is not a saving: the courier re-weighs at the hub and bills
 * the difference back with a penalty, so the only thing a low number buys is
 * a surprise on the invoice.
 */
export const DEFAULT_PARCEL: Parcel = {
  weightKg: 0.5,
  lengthCm: 20,
  breadthCm: 15,
  heightCm: 3,
};

export interface ShipTo {
  readonly name: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly phone: string;
  readonly email: string | null;
}

export interface ShipmentItem {
  readonly name: string;
  readonly sku: string;
  readonly units: number;
  /** Rupees, which is what Shiprocket prices in. */
  readonly sellingPrice: number;
}

export interface CreatedShipment {
  readonly orderId: number;
  readonly shipmentId: number;
  readonly status: string;
}

/**
 * Hand one order to Shiprocket.
 *
 * `reference` is our own order number and becomes Shiprocket's `order_id`, so
 * a parcel can be traced back here from their dashboard without a lookup
 * table. It must be unique on the account — Shiprocket refuses a repeat —
 * which our order numbers already are.
 *
 * Everything is shipped Prepaid: the buyer has already paid us before this is
 * ever called, so a COD shipment would collect the money twice.
 */
export async function createShipment(
  config: ShiprocketConfig,
  {
    reference,
    placedAt,
    shipTo,
    items,
    subTotalInr,
    parcel = DEFAULT_PARCEL,
  }: {
    reference: string;
    placedAt: Date;
    shipTo: ShipTo;
    items: readonly ShipmentItem[];
    subTotalInr: number;
    parcel?: Parcel;
  },
): Promise<CreatedShipment> {
  if (items.length === 0) {
    throw new ShiprocketError('A shipment needs at least one item.', 400);
  }

  // Shiprocket splits the recipient into first and last name and rejects an
  // empty last name, which a single-word name would otherwise produce.
  const parts = shipTo.name.trim().split(/\s+/);
  const firstName = parts[0] ?? 'Customer';
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '.';

  const body = {
    order_id: reference,
    order_date: placedAt.toISOString().slice(0, 19).replace('T', ' '),
    pickup_location: config.pickupLocation,

    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: shipTo.line1,
    billing_address_2: shipTo.line2 ?? '',
    billing_city: shipTo.city,
    billing_pincode: shipTo.postalCode,
    billing_state: shipTo.state,
    billing_country: 'India',
    billing_email: shipTo.email ?? '',
    billing_phone: shipTo.phone.replace(/\D/g, '').slice(-10),

    // The bill and the parcel go to the same person; the invoice is already
    // fixed to this address at checkout, and letting them diverge here would
    // mean shipping somewhere the invoice does not name.
    shipping_is_billing: true,

    order_items: items.map((i) => ({
      name: i.name,
      sku: i.sku,
      units: i.units,
      selling_price: i.sellingPrice,
    })),

    payment_method: 'Prepaid',
    sub_total: subTotalInr,
    length: parcel.lengthCm,
    breadth: parcel.breadthCm,
    height: parcel.heightCm,
    weight: parcel.weightKg,
  };

  const result = await call<{ order_id?: number; shipment_id?: number; status?: string }>(
    config,
    '/orders/create/adhoc',
    { method: 'POST', body },
  );

  if (typeof result.order_id !== 'number' || typeof result.shipment_id !== 'number') {
    throw new ShiprocketError('The delivery partner returned an incomplete shipment.', 502);
  }

  return {
    orderId: result.order_id,
    shipmentId: result.shipment_id,
    status: result.status ?? 'NEW',
  };
}

export interface AssignedAwb {
  readonly awb: string;
  readonly courierName: string | null;
}

/**
 * Get an AWB — the tracking number the buyer actually cares about.
 *
 * Separate from creating the shipment because it can fail on its own terms:
 * no courier serves that pin code, or the account is out of balance. An order
 * that exists at Shiprocket without an AWB is recoverable by retrying this;
 * one that was never created is not.
 */
export async function assignAwb(
  config: ShiprocketConfig,
  shipmentId: number,
): Promise<AssignedAwb> {
  const result = await call<{
    response?: { data?: { awb_code?: string | number; courier_name?: string } };
  }>(config, '/courier/assign/awb', { method: 'POST', body: { shipment_id: shipmentId } });

  const data = result.response?.data;
  const raw = data?.awb_code;
  const awb = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : null;
  if (awb === null || awb === '') {
    throw new ShiprocketError('No courier could be assigned to this parcel.', 502);
  }

  return { awb, courierName: data?.courier_name ?? null };
}

/** Ask for the parcel to be collected. */
export async function requestPickup(
  config: ShiprocketConfig,
  shipmentId: number,
): Promise<boolean> {
  await call(config, '/courier/generate/pickup', {
    method: 'POST',
    body: { shipment_id: [shipmentId] },
  });
  return true;
}

export interface TrackingEvent {
  readonly at: string;
  readonly status: string;
  readonly location: string | null;
}

export interface Tracking {
  readonly awb: string;
  readonly status: string;
  readonly courierName: string | null;
  readonly deliveredAt: string | null;
  readonly events: readonly TrackingEvent[];
}

/** Where the parcel is. */
export async function track(config: ShiprocketConfig, awb: string): Promise<Tracking | null> {
  const result = await call<Record<string, unknown>>(
    config,
    `/courier/track/awb/${encodeURIComponent(awb)}`,
  );

  // Shiprocket has nested this under `tracking_data` and, in some accounts,
  // under the AWB itself. Both are accepted rather than one being guessed at.
  const byAwb = result[awb];
  const holder =
    typeof byAwb === 'object' && byAwb !== null ? (byAwb as Record<string, unknown>) : result;
  const data = holder['tracking_data'];
  if (typeof data !== 'object' || data === null) return null;

  const t = data as Record<string, unknown>;
  const activities = Array.isArray(t['shipment_track_activities'])
    ? (t['shipment_track_activities'] as Record<string, unknown>[])
    : [];
  const leg = Array.isArray(t['shipment_track'])
    ? ((t['shipment_track'] as Record<string, unknown>[])[0] ?? {})
    : {};

  return {
    awb,
    status: typeof leg['current_status'] === 'string' ? leg['current_status'] : 'Unknown',
    courierName: typeof leg['courier_name'] === 'string' ? leg['courier_name'] : null,
    deliveredAt: typeof leg['delivered_date'] === 'string' ? leg['delivered_date'] : null,
    events: activities.map((a) => ({
      at: typeof a['date'] === 'string' ? a['date'] : '',
      status: typeof a['activity'] === 'string' ? a['activity'] : '',
      location: typeof a['location'] === 'string' ? a['location'] : null,
    })),
  };
}

/**
 * Shiprocket's status vocabulary, mapped onto this system's order states.
 *
 * Only the transitions that mean something here are listed. Anything else is
 * recorded against the shipment and leaves the order alone — an order does
 * not need a state for "reached destination hub", and inventing one would
 * mean every courier's vocabulary leaking into our domain.
 */
export function orderStateFor(shiprocketStatus: string): string | null {
  const status = shiprocketStatus.trim().toUpperCase();
  if (status === 'DELIVERED') return 'delivered';
  if (status === 'PICKED UP' || status === 'SHIPPED' || status === 'IN TRANSIT') return 'shipped';
  return null;
}
