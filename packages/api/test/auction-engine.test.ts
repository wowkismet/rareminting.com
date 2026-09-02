import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAntiSnipe,
  increment,
  minimumBid,
  placeBid,
  reserveMet,
  type ProxyState,
} from '../src/auction-engine.ts';

/**
 * The bidding rules.
 *
 * Exhaustive because this is where an auction is won or lost — an off-by-one
 * increment here is somebody's money.
 */

const EMPTY: ProxyState = { currentPaise: 0, leaderId: null, leaderMaxPaise: 0 };
const START = 1_000_00; // ₹1,000

function open(bidder: string, maxPaise: number): ProxyState {
  const result = placeBid(EMPTY, START, bidder, maxPaise);
  assert.ok(result.ok);
  return result.state;
}

describe('increment', () => {
  it('scales with the price', () => {
    assert.equal(increment(50_00), 5_00);
    assert.equal(increment(500_00), 25_00);
    assert.equal(increment(5_000_00), 100_00);
    assert.equal(increment(20_000_00), 500_00);
    assert.equal(increment(1_00_000_00), 1_000_00);
    assert.equal(increment(5_00_000_00), 5_000_00);
  });

  it('is always a positive whole number of paise', () => {
    for (const price of [0, 1, 99_99, 100_00, 9_99_99_99]) {
      const step = increment(price);
      assert.ok(Number.isSafeInteger(step) && step > 0);
    }
  });
});

describe('the first bid', () => {
  it('opens at the starting price, not at the bidder’s maximum', () => {
    const state = open('alice', 5_000_00);
    assert.equal(state.currentPaise, START, 'alice should not bid against herself');
    assert.equal(state.leaderId, 'alice');
    assert.equal(state.leaderMaxPaise, 5_000_00);
  });

  it('is refused below the starting price', () => {
    const result = placeBid(EMPTY, START, 'alice', 900_00);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'below_minimum');
  });
});

describe('proxy bidding', () => {
  it('lets a higher maximum take the lead at one increment over the old one', () => {
    const first = open('alice', 2_000_00);
    const result = placeBid(first, START, 'bob', 5_000_00);
    assert.ok(result.ok);
    assert.equal(result.tookLead, true);
    assert.equal(result.state.leaderId, 'bob');
    // Bob pays just enough to clear Alice's ceiling, not his own maximum.
    assert.equal(result.state.currentPaise, 2_000_00 + increment(2_000_00));
    assert.ok(result.state.currentPaise < 5_000_00, 'bob overpaid');
  });

  it('pushes the price up to a loser’s maximum without giving them the lead', () => {
    const first = open('alice', 5_000_00);
    const result = placeBid(first, START, 'bob', 3_000_00);
    assert.ok(result.ok);
    assert.equal(result.tookLead, false);
    assert.equal(result.state.leaderId, 'alice', 'alice still has the higher ceiling');
    assert.ok(result.state.currentPaise > 3_000_00 - 1, 'the price should rise to meet bob');
    assert.ok(result.state.currentPaise <= 5_000_00);
  });

  it('gives a tie to whoever committed first', () => {
    const first = open('alice', 3_000_00);
    const result = placeBid(first, START, 'bob', 3_000_00);
    assert.ok(result.ok);
    assert.equal(result.tookLead, false, 'the later identical bid must not win');
    assert.equal(result.state.leaderId, 'alice');
  });

  it('never charges the leader more than their own maximum', () => {
    const first = open('alice', 2_000_00);
    const result = placeBid(first, START, 'bob', 2_050_00);
    assert.ok(result.ok);
    assert.equal(result.state.leaderId, 'bob');
    assert.ok(
      result.state.currentPaise <= 2_050_00,
      `bob was charged ${result.state.currentPaise}, above his maximum`,
    );
  });

  it('lets the leader raise their ceiling without moving the price', () => {
    const first = open('alice', 2_000_00);
    const result = placeBid(first, START, 'alice', 9_000_00);
    assert.ok(result.ok);
    assert.equal(result.state.currentPaise, first.currentPaise, 'alice bid against herself');
    assert.equal(result.state.leaderMaxPaise, 9_000_00);
  });

  it('refuses the leader lowering their own ceiling', () => {
    const first = open('alice', 5_000_00);
    const result = placeBid(first, START, 'alice', 2_000_00);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'not_higher');
  });

  it('refuses a bid below the current price plus an increment', () => {
    const first = open('alice', 2_000_00);
    const minimum = minimumBid(first, START);
    const result = placeBid(first, START, 'bob', minimum - 1);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'below_minimum');
  });

  it('never lets the price go down, whatever the sequence', () => {
    let state = open('alice', 10_000_00);
    let last = state.currentPaise;
    const bids: [string, number][] = [
      ['bob', 2_000_00],
      ['carol', 8_000_00],
      ['bob', 3_000_00],
      ['dave', 15_000_00],
      ['alice', 20_000_00],
      ['carol', 4_000_00],
    ];
    for (const [bidder, max] of bids) {
      const result = placeBid(state, START, bidder, max);
      if (!result.ok) continue;
      state = result.state;
      assert.ok(state.currentPaise >= last, 'the price went backwards');
      assert.ok(
        state.currentPaise <= state.leaderMaxPaise,
        'the leader was charged above their maximum',
      );
      last = state.currentPaise;
    }
    assert.equal(state.leaderId, 'alice', 'the highest maximum should be winning');
  });
});

describe('anti-sniping', () => {
  const now = new Date('2026-09-02T12:00:00Z');

  it('extends when a bid lands inside the window', () => {
    const endsAt = new Date(now.getTime() + 30 * 1000);
    const result = applyAntiSnipe(endsAt, now, 120, 0, 20);
    assert.equal(result.extended, true);
    assert.equal(result.endsAt.getTime(), now.getTime() + 120 * 1000);
  });

  it('leaves an auction alone when there is plenty of time left', () => {
    const endsAt = new Date(now.getTime() + 3600 * 1000);
    const result = applyAntiSnipe(endsAt, now, 120, 0, 20);
    assert.equal(result.extended, false);
    assert.equal(result.endsAt.getTime(), endsAt.getTime());
  });

  it('stops extending once the cap is reached, so it cannot run forever', () => {
    const endsAt = new Date(now.getTime() + 10 * 1000);
    const result = applyAntiSnipe(endsAt, now, 120, 20, 20);
    assert.equal(result.extended, false);
    assert.equal(result.endsAt.getTime(), endsAt.getTime());
  });

  it('always pushes the close to a fixed window from now, not from the old close', () => {
    // Otherwise repeated late bids would extend by less and less.
    const endsAt = new Date(now.getTime() + 1000);
    const result = applyAntiSnipe(endsAt, now, 120, 5, 20);
    assert.equal(result.endsAt.getTime() - now.getTime(), 120 * 1000);
  });
});

describe('reserve', () => {
  it('is met when there is none', () => {
    assert.equal(reserveMet(1, null), true);
  });

  it('needs the price to reach it', () => {
    assert.equal(reserveMet(4_999_00, 5_000_00), false);
    assert.equal(reserveMet(5_000_00, 5_000_00), true);
    assert.equal(reserveMet(5_001_00, 5_000_00), true);
  });
});
