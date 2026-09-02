import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  maskAadhaarIn,
  maskMobile,
  panAgreesWithName,
  parseAadhaar,
  parseIndianMobile,
  parsePan,
  verhoeffValid,
} from '../src/identity.ts';

/**
 * Every Aadhaar number here is synthetic: an arbitrary 11-digit prefix with
 * whichever check digit makes it valid, found by trying all ten. No real
 * number appears in this repository.
 */
function synthesise(prefix11: string): string {
  for (let d = 0; d < 10; d += 1) {
    const candidate = `${prefix11}${d}`;
    if (verhoeffValid(candidate)) return candidate;
  }
  throw new Error(`no check digit completes ${prefix11}`);
}

describe('Verhoeff', () => {
  it('accepts a number carrying its own check digit', () => {
    assert.ok(verhoeffValid(synthesise('23456789012')));
  });

  it('rejects every single-digit error', () => {
    const valid = synthesise('34567890123');
    for (let i = 0; i < valid.length; i += 1) {
      for (let d = 0; d < 10; d += 1) {
        const digit = String(d);
        if (valid.charAt(i) === digit) continue;
        const corrupted = valid.slice(0, i) + digit + valid.slice(i + 1);
        assert.equal(verhoeffValid(corrupted), false, `missed a typo at ${i}: ${corrupted}`);
      }
    }
  });

  it('rejects every adjacent transposition', () => {
    const valid = synthesise('98765432101');
    for (let i = 0; i < valid.length - 1; i += 1) {
      const a = valid.charAt(i);
      const b = valid.charAt(i + 1);
      if (a === b) continue;
      const swapped = valid.slice(0, i) + b + a + valid.slice(i + 2);
      assert.equal(verhoeffValid(swapped), false, `missed a swap at ${i}: ${swapped}`);
    }
  });

  it('rejects non-digits', () => {
    assert.equal(verhoeffValid('2345678901X'), false);
    assert.equal(verhoeffValid('2345 678 9012'), false);
    assert.equal(verhoeffValid(''), false);
  });
});

describe('parseAadhaar', () => {
  const valid = synthesise('45678901234');

  it('accepts a well-formed number and never returns it unmasked by accident', () => {
    const parsed = parseAadhaar(valid);
    assert.ok(parsed !== null);
    assert.equal(parsed.normalized, valid);
    assert.equal(parsed.last4, valid.slice(-4));
    assert.equal(parsed.masked, `XXXX XXXX ${valid.slice(-4)}`);
    assert.equal(parsed.masked.includes(valid.slice(0, 8)), false);
  });

  it('accepts the spacing and hyphens people actually type', () => {
    const spaced = `${valid.slice(0, 4)} ${valid.slice(4, 8)} ${valid.slice(8)}`;
    const hyphened = `${valid.slice(0, 4)}-${valid.slice(4, 8)}-${valid.slice(8)}`;
    assert.equal(parseAadhaar(spaced)?.normalized, valid);
    assert.equal(parseAadhaar(hyphened)?.normalized, valid);
  });

  it('rejects the reserved leading digits', () => {
    // UIDAI issues nothing starting 0 or 1, so these are made up by construction.
    for (const lead of ['0', '1']) {
      const candidate = synthesise(`${lead}5678901234`);
      assert.equal(parseAadhaar(candidate), null, `accepted a reserved range: ${candidate}`);
    }
  });

  it('rejects wrong lengths and bad checksums', () => {
    assert.equal(parseAadhaar(valid.slice(0, 11)), null);
    assert.equal(parseAadhaar(`${valid}5`), null);
    const badCheck = `${valid.slice(0, 11)}${(Number(valid.slice(11)) + 1) % 10}`;
    assert.equal(parseAadhaar(badCheck), null);
  });
});

describe('maskAadhaarIn', () => {
  it('masks a number that leaked into free text', () => {
    const valid = synthesise('56789012345');
    const masked = maskAadhaarIn(`my aadhaar is ${valid} thanks`);
    assert.equal(masked.includes(valid), false);
    assert.ok(masked.includes(`XXXX XXXX ${valid.slice(-4)}`));
  });

  it('leaves a twelve-digit number that is not a valid Aadhaar alone', () => {
    // An order reference or serial must not be mangled into a mask.
    const notAadhaar = '234567890123';
    assert.equal(verhoeffValid(notAadhaar), false, 'test relies on this failing the checksum');
    assert.equal(maskAadhaarIn(`reference ${notAadhaar}`), `reference ${notAadhaar}`);
  });
});

describe('parsePan', () => {
  it('reads the structure', () => {
    const pan = parsePan('abcpe1234f');
    assert.ok(pan !== null);
    assert.equal(pan.normalized, 'ABCPE1234F');
    assert.equal(pan.holderCode, 'P');
    assert.equal(pan.holderType, 'Individual');
    assert.equal(pan.nameInitial, 'E');
    assert.equal(pan.last4, '234F');
  });

  it('rejects an unknown holder code', () => {
    // 'X' is not one of the ten assigned categories.
    assert.equal(parsePan('ABCXE1234F'), null);
  });

  it('rejects malformed input', () => {
    for (const bad of ['ABCPE1234', 'ABCPE12345', '1BCPE1234F', 'ABCPEA234F', 'ABCP31234F', '']) {
      assert.equal(parsePan(bad), null, `accepted ${bad}`);
    }
  });

  it('agrees with a name sharing the fifth character', () => {
    const pan = parsePan('ABCPK1234F');
    assert.ok(pan !== null);
    assert.equal(panAgreesWithName(pan, 'Ravi Kumar'), true);
    assert.equal(panAgreesWithName(pan, 'Ravi Sharma'), false);
    assert.equal(panAgreesWithName(pan, ''), false);
  });
});

describe('parseIndianMobile', () => {
  it('normalises the forms people type', () => {
    for (const input of [
      '9812345678',
      '+919812345678',
      '919812345678',
      '09812345678',
      '+91 98123 45678',
      '+91-98123-45678',
    ]) {
      assert.equal(parseIndianMobile(input), '+919812345678', `failed on ${input}`);
    }
  });

  it('rejects landlines, short numbers and bad prefixes', () => {
    for (const bad of ['1234567890', '5812345678', '981234567', '98123456789', 'abcdefghij']) {
      assert.equal(parseIndianMobile(bad), null, `accepted ${bad}`);
    }
  });

  it('masks the middle for support screens', () => {
    assert.equal(maskMobile('+919812345678'), '+91 98xxxxxx78');
  });
});
