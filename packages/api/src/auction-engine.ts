/**
 * Proxy bidding and anti-sniping, as pure functions.
 *
 * Kept free of the database so the rules can be tested exhaustively, because
 * this is where an auction is won or lost and an off-by-one increment is money.
 *
 * The model is the familiar one. A bidder states the most they are willing to
 * pay; the engine bids on their behalf only as far as it must to stay ahead.
 * So the price is set by the *second* highest maximum, not the highest, and the
 * winner usually pays less than they were prepared to.
 */

/**
 * The bid increment, tiered by current price.
 *
 * A flat increment is wrong at both ends: ₹10 steps are absurd on a ₹2 lakh
 * note and ₹1,000 steps price everyone out of a ₹500 one.
 */
export function increment(currentPaise: number): number {
  if (currentPaise < 100_00) return 5_00; // under ₹100 → ₹5
  if (currentPaise < 1_000_00) return 25_00; // under ₹1,000 → ₹25
  if (currentPaise < 10_000_00) return 100_00; // under ₹10,000 → ₹100
  if (currentPaise < 50_000_00) return 500_00; // under ₹50,000 → ₹500
  if (currentPaise < 2_00_000_00) return 1_000_00; // under ₹2,00,000 → ₹1,000
  return 5_000_00; // above that → ₹5,000
}

export interface ProxyState {
  /** The price the auction currently stands at. */
  readonly currentPaise: number;
  /** Who is winning, or null before any bid. */
  readonly leaderId: string | null;
  /** The leader's ceiling. Never revealed to other bidders. */
  readonly leaderMaxPaise: number;
}

export type BidOutcome =
  | { readonly ok: false; readonly reason: 'below_minimum'; readonly minimumPaise: number }
  | { readonly ok: false; readonly reason: 'not_higher' }
  | {
      readonly ok: true;
      /** The state after the bid. */
      readonly state: ProxyState;
      /** True when this bid took the lead. */
      readonly tookLead: boolean;
    };

/** The least a new bidder may offer. */
export function minimumBid(state: ProxyState, startingPaise: number): number {
  if (state.leaderId === null) return startingPaise;
  return state.currentPaise + increment(state.currentPaise);
}

/**
 * Apply a bid.
 *
 * `maxPaise` is what the bidder is willing to go to. Three things can happen:
 * they outbid the leader and take over at just enough to beat them; they fail
 * to beat the leader and merely push the price up to their own maximum; or
 * their bid is too low to count at all.
 */
export function placeBid(
  state: ProxyState,
  startingPaise: number,
  bidderId: string,
  maxPaise: number,
): BidOutcome {
  if (!Number.isSafeInteger(maxPaise) || maxPaise <= 0) {
    return { ok: false, reason: 'below_minimum', minimumPaise: minimumBid(state, startingPaise) };
  }

  // The first bid simply opens at the starting price.
  if (state.leaderId === null) {
    if (maxPaise < startingPaise) {
      return { ok: false, reason: 'below_minimum', minimumPaise: startingPaise };
    }
    return {
      ok: true,
      tookLead: true,
      state: { currentPaise: startingPaise, leaderId: bidderId, leaderMaxPaise: maxPaise },
    };
  }

  // The leader raising their own ceiling. The price does not move — there is
  // nobody to outbid — but their headroom increases.
  if (state.leaderId === bidderId) {
    if (maxPaise <= state.leaderMaxPaise) return { ok: false, reason: 'not_higher' };
    return {
      ok: true,
      tookLead: false,
      state: { ...state, leaderMaxPaise: maxPaise },
    };
  }

  const minimum = minimumBid(state, startingPaise);
  if (maxPaise < minimum) {
    return { ok: false, reason: 'below_minimum', minimumPaise: minimum };
  }

  // Beats the leader's ceiling: take the lead, paying just enough to clear it
  // — one increment above, or their own maximum if that is lower.
  if (maxPaise > state.leaderMaxPaise) {
    const next = Math.min(state.leaderMaxPaise + increment(state.leaderMaxPaise), maxPaise);
    return {
      ok: true,
      tookLead: true,
      state: {
        currentPaise: Math.max(next, state.currentPaise),
        leaderId: bidderId,
        leaderMaxPaise: maxPaise,
      },
    };
  }

  // Does not beat the leader. The leader keeps the lot, but the price rises to
  // this bidder's maximum — the leader's proxy automatically covers it. A tie
  // goes to the leader, who committed to that number first.
  const next = Math.min(maxPaise + increment(maxPaise), state.leaderMaxPaise);
  return {
    ok: true,
    tookLead: false,
    state: {
      ...state,
      currentPaise: Math.max(next, state.currentPaise, maxPaise),
    },
  };
}

export interface SnipeResult {
  readonly endsAt: Date;
  readonly extended: boolean;
}

/**
 * Extend the close when a bid lands in the dying seconds.
 *
 * Without this, an auction rewards whoever has the fastest connection rather
 * than whoever values the lot most: a bid in the last second wins with nobody
 * given a chance to answer. Extending gives everyone that chance. The cap stops
 * two determined bidders extending an auction indefinitely.
 */
export function applyAntiSnipe(
  endsAt: Date,
  now: Date,
  antiSnipeSeconds: number,
  extensionCount: number,
  maxExtensions: number,
): SnipeResult {
  if (extensionCount >= maxExtensions) return { endsAt, extended: false };

  const remainingMs = endsAt.getTime() - now.getTime();
  if (remainingMs > antiSnipeSeconds * 1000) return { endsAt, extended: false };

  return {
    endsAt: new Date(now.getTime() + antiSnipeSeconds * 1000),
    extended: true,
  };
}

/** Did the auction meet its reserve? */
export function reserveMet(currentPaise: number, reservePaise: number | null): boolean {
  return reservePaise === null || currentPaise >= reservePaise;
}
