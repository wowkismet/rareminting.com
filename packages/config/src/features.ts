/**
 * Things that can be turned off without taking them out.
 *
 * A flag here hides a feature from the site. It does not delete anything, does
 * not migrate the database and does not touch what sellers or buyers have
 * already done — which is the whole point.
 */

/**
 * Whether auctions are open.
 *
 * Paused on 16 September 2026 at the owner's request.
 *
 * Off means: no Auctions link in the header, the footer or the dashboard; the
 * auctions page says so rather than 404ing; sellers cannot list one or convert
 * a fixed-price listing into one; and the API refuses to create one, because
 * hiding a button is not the same as closing a route.
 *
 * Off does NOT mean anything is destroyed. Five auction rows, four bids from
 * three bidders and the listings still marked `sale_mode = 'auction'` are
 * untouched underneath and come back exactly as they were. That mattered here:
 * one ended auction was won and its listing is reserved against a buyer
 * part-way through paying, so the data had to survive the feature being
 * hidden. Reading and bidding on what already exists are left alone for the
 * same reason — blocking those would break a commitment rather than pause a
 * feature.
 *
 * A function rather than a constant so the answer is read when it is asked
 * for, not when the module first loads. That is what lets the test suite turn
 * auctions on for the tests that exercise the engine, and what lets the server
 * flip this with an environment variable and a restart instead of a deploy:
 *
 *     AUCTIONS_ENABLED=true   in /etc/rareminting.env, then restart
 *
 * Nothing re-enables it on a timer. It stays off until somebody says so, which
 * is deliberate — a payments-adjacent feature switching itself back on
 * unannounced is worse than one that waits to be asked.
 */
export function auctionsEnabled(): boolean {
  return process.env['AUCTIONS_ENABLED'] === 'true';
}
