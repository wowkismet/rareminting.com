import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSerialInput, parseSerial, serialRegistryKey } from '../src/index.ts';
import type { ParsedSerial } from '../src/index.ts';

function expectOk(raw: string, options?: Parameters<typeof parseSerial>[1]): ParsedSerial {
  const result = parseSerial(raw, options);
  assert.equal(result.ok, true, `expected ${JSON.stringify(raw)} to parse`);
  if (!result.ok) throw new Error('unreachable');
  return result.serial;
}

function expectFail(raw: string, code: string): void {
  const result = parseSerial(raw);
  assert.equal(result.ok, false, `expected ${JSON.stringify(raw)} to fail`);
  if (result.ok) throw new Error('unreachable');
  assert.equal(result.errors[0]?.code, code);
}

describe('normalizeSerialInput', () => {
  it('uppercases, trims and collapses whitespace', () => {
    assert.equal(normalizeSerialInput('  9ab   150892 '), '9AB 150892');
  });

  it('normalises unicode star glyphs to an ASCII asterisk', () => {
    assert.equal(normalizeSerialInput('9AB★ 150892'), '9AB* 150892');
    assert.equal(normalizeSerialInput('9AB✱ 150892'), '9AB* 150892');
  });

  it('never removes whitespace between digits', () => {
    // A/1 123456 would be destroyed by a blanket digit-space strip.
    assert.equal(normalizeSerialInput('A/1 123456'), 'A/1 123456');
  });
});

describe('parseSerial — Mahatma Gandhi series', () => {
  it('decomposes a standard serial into prefix, letters and digits', () => {
    const serial = expectOk('9AB 150892');
    assert.equal(serial.format, 'IN_MG_NEW');
    assert.equal(serial.prefix, '9AB');
    assert.equal(serial.prefixNumeral, '9');
    assert.equal(serial.prefixLetters, 'AB');
    assert.equal(serial.serialDigits, '150892');
    assert.equal(serial.serialValue, 150892);
    assert.equal(serial.digitCount, 6);
    assert.equal(serial.isStar, false);
    assert.equal(serial.insetLetter, null);
  });

  it('detects the star-series marker', () => {
    assert.equal(expectOk('9AB* 150892').isStar, true);
    assert.equal(expectOk('9AB*150892').isStar, true);
    assert.equal(expectOk('9AB★ 150892').isStar, true);
  });

  it('accepts lowercase input', () => {
    assert.equal(expectOk('9ab 150892').prefix, '9AB');
  });

  it('accepts the serial with no separator', () => {
    assert.equal(expectOk('9AB150892').serialDigits, '150892');
  });

  it('accepts a space inside the six digits, as printed on dealer sheets', () => {
    assert.equal(expectOk('9AB 150 892').serialDigits, '150892');
  });

  it('captures a leading inset letter', () => {
    const serial = expectOk('L 9AB 150892');
    assert.equal(serial.insetLetter, 'L');
    assert.equal(serial.prefix, '9AB');
  });

  it('preserves leading zeros — 000001 is not 1', () => {
    const serial = expectOk('9AB 000001');
    assert.equal(serial.serialDigits, '000001');
    assert.equal(serial.serialValue, 1);
    assert.equal(serial.digitCount, 6);
  });

  it('produces a canonical display form', () => {
    assert.equal(expectOk('  9ab★150892 ').normalized, '9AB* 150892');
    assert.equal(expectOk('l 9ab 150892').normalized, 'L 9AB 150892');
  });
});

describe('parseSerial — other layouts', () => {
  it('parses a legacy fractional prefix', () => {
    const serial = expectOk('A/1 123456');
    assert.equal(serial.format, 'IN_LEGACY');
    assert.equal(serial.prefix, 'A/1');
    assert.equal(serial.serialDigits, '123456');
  });

  it('parses a bare digit block with no prefix', () => {
    const serial = expectOk('150892');
    assert.equal(serial.format, 'GENERIC');
    assert.equal(serial.prefix, null);
    assert.equal(serial.serialDigits, '150892');
  });

  it('parses a world note with an alphabetic prefix and 7 digits', () => {
    const serial = expectOk('AB 1234567');
    assert.equal(serial.format, 'GENERIC');
    assert.equal(serial.prefix, 'AB');
    assert.equal(serial.insetLetter, null, 'the A must not be mistaken for an inset letter');
    assert.equal(serial.serialDigits, '1234567');
  });
});

describe('parseSerial — rejection', () => {
  it('rejects empty input', () => {
    expectFail('', 'EMPTY_INPUT');
    expectFail('    ', 'EMPTY_INPUT');
  });

  it('rejects input with no digits at all', () => {
    expectFail('HELLO', 'NO_DIGITS');
  });

  it('rejects an implausibly long digit run', () => {
    expectFail('1234567890123', 'DIGIT_COUNT_OUT_OF_RANGE');
  });

  it('rejects a layout it does not recognise', () => {
    expectFail('9AB 15/08/92', 'UNRECOGNIZED_FORMAT');
  });
});

describe('parseSerial — OCR repair', () => {
  it('is off by default, so a human-entered typo is not silently rewritten', () => {
    const result = parseSerial('9AB 15O892');
    assert.equal(result.ok, false);
  });

  it('resolves look-alike letters in digit positions when enabled', () => {
    const result = parseSerial('9AB 15O892', { repairOcrConfusions: true });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('unreachable');
    assert.equal(result.serial.serialDigits, '150892');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0] ?? '', /O→0/);
    assert.match(result.warnings[0] ?? '', /Confirm before publishing/);
  });

  it('repairs several confusions in one block', () => {
    const result = parseSerial('9AB ISO892', { repairOcrConfusions: true });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('unreachable');
    assert.equal(result.serial.serialDigits, '150892');
  });

  it('never rewrites letters in the prefix', () => {
    // 9OB is a legitimate prefix; repair must not turn it into 90B.
    const result = parseSerial('9OB 150892', { repairOcrConfusions: true });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('unreachable');
    assert.equal(result.serial.prefix, '9OB');
    assert.equal(result.serial.serialDigits, '150892');
    assert.deepEqual(result.warnings, []);
  });

  it('refuses to invent a digit block out of pure letters', () => {
    const result = parseSerial('OILS', { repairOcrConfusions: true });
    assert.equal(result.ok, false);
  });
});

describe('serialRegistryKey', () => {
  it('separates the same digits on different denominations', () => {
    const serial = expectOk('9AB 150892');
    assert.notEqual(
      serialRegistryKey(serial, 100, 'MG New Series'),
      serialRegistryKey(serial, 500, 'MG New Series'),
    );
  });

  it('separates a star note from its plain counterpart', () => {
    assert.notEqual(
      serialRegistryKey(expectOk('9AB 150892'), 100, 'MG New Series'),
      serialRegistryKey(expectOk('9AB* 150892'), 100, 'MG New Series'),
    );
  });

  it('is stable across input formatting differences', () => {
    assert.equal(
      serialRegistryKey(expectOk('9AB 150892'), 100, 'MG New Series'),
      serialRegistryKey(expectOk('  9ab150892  '), 100, 'mg new series'),
    );
  });
});
