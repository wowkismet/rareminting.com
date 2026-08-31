import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyPatterns,
  digitalRoot,
  isRadar,
  isSolid,
  ladderKind,
  nearestPremiumPattern,
  rarityScore,
  smallestRepeatingBlock,
} from '../src/index.ts';
import type { PatternCode, PatternTag } from '../src/index.ts';

function codes(digits: string): PatternCode[] {
  return classifyPatterns(digits).map((entry) => entry.code);
}

function tagFor(digits: string, code: PatternCode): PatternTag {
  const found = classifyPatterns(digits).find((entry) => entry.code === code);
  assert.ok(found !== undefined, `expected ${digits} to carry ${code}, got ${codes(digits).join(', ')}`);
  return found;
}

describe('structural predicates', () => {
  it('identifies solids', () => {
    assert.equal(isSolid('777777'), true);
    assert.equal(isSolid('123456'), false);
    assert.equal(isSolid('7'), false, 'a single digit is not a solid');
  });

  it('identifies radars but not solids', () => {
    assert.equal(isRadar('123321'), true);
    assert.equal(isRadar('12321'), true, 'odd lengths are palindromes too');
    assert.equal(isRadar('777777'), false, 'a solid is classified as a solid, not a radar');
    assert.equal(isRadar('123456'), false);
  });

  it('distinguishes clean ladders from wrapping ones', () => {
    assert.equal(ladderKind('123456'), 'asc');
    assert.equal(ladderKind('654321'), 'desc');
    assert.equal(ladderKind('456789'), 'asc');
    assert.equal(ladderKind('890123'), 'asc-wrap');
    assert.equal(ladderKind('210987'), 'desc-wrap');
    assert.equal(ladderKind('150892'), null);
  });

  it('finds the smallest tiling block', () => {
    assert.equal(smallestRepeatingBlock('123123'), 3);
    assert.equal(smallestRepeatingBlock('121212'), 2);
    assert.equal(smallestRepeatingBlock('777777'), 1);
    assert.equal(smallestRepeatingBlock('150892'), 6, 'no repetition means the block is the whole serial');
  });

  it('computes the digital root', () => {
    assert.equal(digitalRoot('150892'), 7);
    assert.equal(digitalRoot('999999'), 9);
    assert.equal(digitalRoot('000000'), 0);
  });
});

describe('classifyPatterns — headline patterns', () => {
  it('tags a solid at full weight', () => {
    const tag = tagFor('777777', 'SOLID');
    assert.equal(tag.weight, 1);
    assert.match(tag.detail ?? '', /all 6 digits are 7/);
    assert.ok(!codes('777777').includes('BINARY'), 'a solid uses one digit, not two');
  });

  it('tags a radar', () => {
    assert.ok(codes('123321').includes('RADAR'));
  });

  it('tags ascending and descending ladders separately', () => {
    assert.ok(codes('123456').includes('LADDER_ASC'));
    assert.ok(codes('654321').includes('LADDER_DESC'));
    assert.ok(codes('890123').includes('LADDER_ASC_WRAP'));
  });

  it('ranks a descending ladder at least as high as an ascending one', () => {
    assert.ok(tagFor('654321', 'LADDER_DESC').weight >= tagFor('123456', 'LADDER_ASC').weight);
  });

  it('tags a repeater with its block structure', () => {
    const tag = tagFor('123123', 'REPEATER');
    assert.match(tag.detail ?? '', /block of 3 repeated 2 times/);
  });

  it('does not call a non-repeating serial a repeater', () => {
    assert.ok(!codes('112233').includes('REPEATER'));
  });

  it('tags double and triple pairs', () => {
    assert.ok(codes('112233').includes('DOUBLE_PAIRS'));
    assert.ok(codes('111222').includes('TRIPLE_PAIRS'));
    assert.ok(!codes('121212').includes('DOUBLE_PAIRS'), 'alternating digits are not runs of two');
  });

  it('honours the spec rank: solid > radar > ladder > repeater > semi-fancy', () => {
    const weight = (digits: string, code: PatternCode): number => tagFor(digits, code).weight;
    assert.ok(weight('777777', 'SOLID') > weight('123321', 'RADAR'));
    assert.ok(weight('123321', 'RADAR') > weight('654321', 'LADDER_DESC'));
    assert.ok(weight('654321', 'LADDER_DESC') > weight('123123', 'REPEATER'));
    assert.ok(weight('123123', 'REPEATER') > weight('777775', 'SEMI_FANCY'));
  });
});

describe('classifyPatterns — serial bands', () => {
  it('tiers low serials', () => {
    assert.equal(tagFor('000001', 'LOW_SERIAL').tier, 1);
    assert.equal(tagFor('000009', 'LOW_SERIAL').tier, 1);
    assert.equal(tagFor('000010', 'LOW_SERIAL').tier, 2);
    assert.equal(tagFor('000099', 'LOW_SERIAL').tier, 2);
    assert.equal(tagFor('000100', 'LOW_SERIAL').tier, 3);
  });

  it('weights a lower band above a higher one', () => {
    assert.ok(tagFor('000001', 'LOW_SERIAL').weight > tagFor('000100', 'LOW_SERIAL').weight);
  });

  it('stops tagging beyond the configured band', () => {
    assert.ok(!codes('000101').includes('LOW_SERIAL'));
  });

  it('tags high serials, with the top of the run in tier 1', () => {
    assert.equal(tagFor('999999', 'HIGH_SERIAL').tier, 1);
    assert.equal(tagFor('999990', 'HIGH_SERIAL').tier, 2);
    assert.ok(!codes('999989').includes('HIGH_SERIAL'));
  });

  it('tags binaries', () => {
    assert.ok(codes('101101').includes('BINARY'));
    assert.ok(codes('111222').includes('BINARY'));
    assert.ok(!codes('123456').includes('BINARY'));
  });
});

describe('classifyPatterns — lucky and novelty tokens', () => {
  it('tags 786 wherever it appears, weighted by how it matches', () => {
    const exact = classifyPatterns('786').find((entry) => entry.code === 'LUCKY');
    const suffix = classifyPatterns('000786').find((entry) => entry.code === 'LUCKY');
    const inside = classifyPatterns('178600').find((entry) => entry.code === 'LUCKY');
    assert.ok(exact !== undefined && suffix !== undefined && inside !== undefined);
    assert.ok(exact.weight > suffix.weight);
    assert.ok(suffix.weight > inside.weight);
  });

  it('tags other auspicious numbers', () => {
    assert.ok(codes('000108').includes('LUCKY'));
    assert.ok(codes('000777').includes('LUCKY'));
    assert.ok(codes('001008').includes('LUCKY'));
  });

  it('tags novelty numbers', () => {
    assert.ok(codes('001947').includes('NOVELTY'));
    assert.ok(codes('000420').includes('NOVELTY'));
  });

  it('leaves an ordinary serial untagged by tokens', () => {
    const found = codes('150892');
    assert.ok(!found.includes('LUCKY'));
    assert.ok(!found.includes('NOVELTY'));
  });
});

describe('classifyPatterns — semi-fancy near misses', () => {
  it('measures distance to the nearest premium pattern', () => {
    assert.deepEqual(nearestPremiumPattern('777777'), { distance: 0, pattern: 'solid' });
    assert.equal(nearestPremiumPattern('777775').distance, 1);
    assert.equal(nearestPremiumPattern('123456').distance, 0);
    assert.ok(nearestPremiumPattern('150892').distance > 1);
  });

  it('tags a one-digit miss', () => {
    const tag = tagFor('777775', 'SEMI_FANCY');
    assert.match(tag.detail ?? '', /one digit away from a solid/);
  });

  it('tags a near-radar', () => {
    assert.ok(codes('123322').includes('SEMI_FANCY'));
  });

  it('does not tag a serial that already is the premium pattern', () => {
    assert.ok(!codes('777777').includes('SEMI_FANCY'));
    assert.ok(!codes('123456').includes('SEMI_FANCY'));
    assert.ok(!codes('123321').includes('SEMI_FANCY'));
  });

  it('does not tag a serial that is far from everything', () => {
    assert.ok(!codes('150892').includes('SEMI_FANCY'));
  });
});

describe('classifyPatterns — multiple tags', () => {
  it('reports every pattern a serial satisfies', () => {
    // 101101 is simultaneously a palindrome, a repeating block and a binary.
    const found = codes('101101');
    assert.ok(found.includes('RADAR'));
    assert.ok(found.includes('REPEATER'));
    assert.ok(found.includes('BINARY'));
  });

  it('returns tags in descending weight order', () => {
    const tags = classifyPatterns('101101');
    for (let i = 1; i < tags.length; i += 1) {
      const previous = tags[i - 1];
      const current = tags[i];
      assert.ok(previous !== undefined && current !== undefined);
      assert.ok(previous.weight >= current.weight);
    }
  });

  it('rejects a non-digit block outright', () => {
    assert.throws(() => classifyPatterns('15O892'), TypeError);
  });
});

describe('classifyPatterns — configurability', () => {
  it('lets an operator retune a weight without a code change', () => {
    const tags = classifyPatterns('123456', { config: { weights: { LADDER_ASC: 0.1 } } });
    const ladder = tags.find((entry) => entry.code === 'LADDER_ASC');
    assert.ok(ladder !== undefined);
    assert.equal(ladder.weight, 0.1);
  });

  it('lets an operator add a lucky token', () => {
    const tags = classifyPatterns('000123', {
      config: { luckyTokens: [{ token: '123', label: '123 — house number', weight: 0.9 }] },
    });
    assert.ok(tags.some((entry) => entry.code === 'LUCKY'));
  });

  it('lets an operator widen the low-serial bands', () => {
    const tags = classifyPatterns('000500', {
      config: { lowSerialBands: [{ max: 1000, tier: 1, weight: 0.5 }] },
    });
    assert.ok(tags.some((entry) => entry.code === 'LOW_SERIAL'));
  });
});

describe('rarityScore', () => {
  it('is dominated by the strongest tag', () => {
    assert.equal(rarityScore([{ code: 'SOLID', label: 'Solid', weight: 1, detail: null, tier: null }]), 1);
  });

  it('ranks a solid above an ordinary serial', () => {
    assert.ok(rarityScore(classifyPatterns('777777')) > rarityScore(classifyPatterns('150892')));
  });

  it('never lets a pile of weak tags outrank a single strong one', () => {
    const weak: PatternTag[] = Array.from({ length: 8 }, () => ({
      code: 'NOVELTY' as const,
      label: 'weak',
      weight: 0.4,
      detail: null,
      tier: null,
    }));
    assert.ok(
      rarityScore(weak) <
        rarityScore([{ code: 'SOLID', label: 'Solid', weight: 1, detail: null, tier: null }]),
    );
  });

  it('stays within 0 and 1', () => {
    for (const digits of ['777777', '150892', '000001', '101101', '123456']) {
      const score = rarityScore(classifyPatterns(digits));
      assert.ok(score >= 0 && score <= 1, `${digits} scored ${score}`);
    }
  });

  it('is 0 for a serial with no tags at all', () => {
    assert.equal(rarityScore([]), 0);
  });
});
