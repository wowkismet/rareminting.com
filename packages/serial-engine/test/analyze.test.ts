import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeSerial } from '../src/index.ts';
import type { SerialAnalysis } from '../src/index.ts';

const NOW = new Date('2026-08-31T00:00:00Z');

function analyze(raw: string, options: Parameters<typeof analyzeSerial>[1] = {}): SerialAnalysis {
  const result = analyzeSerial(raw, { now: NOW, ...options });
  assert.ok(result !== null, `expected ${raw} to analyse`);
  return result;
}

describe('analyzeSerial', () => {
  it('combines parsing, date reading and pattern tagging', () => {
    const analysis = analyze('9AB 150892');
    assert.equal(analysis.serial.prefix, '9AB');
    assert.equal(analysis.serial.serialDigits, '150892');
    assert.equal(analysis.bestDate?.iso, '1992-08-15');
    assert.equal(analysis.serial.isStar, false);
    assert.ok(analysis.rarityScore >= 0 && analysis.rarityScore <= 1);
  });

  it('adds a star-series tag from the note, not from the digits', () => {
    const plain = analyze('9AB 150892');
    const star = analyze('9AB* 150892');
    assert.ok(!plain.patterns.some((tag) => tag.code === 'STAR_SERIES'));
    assert.ok(star.patterns.some((tag) => tag.code === 'STAR_SERIES'));
    assert.ok(star.rarityScore > plain.rarityScore, 'a star note must rate rarer than its plain twin');
  });

  it('carries multiple tags for a serial that earns them', () => {
    const analysis = analyze('9AB 101101');
    const codes = analysis.patterns.map((tag) => tag.code);
    assert.ok(codes.includes('RADAR'));
    assert.ok(codes.includes('REPEATER'));
    assert.ok(codes.includes('BINARY'));
  });

  it('scores a solid star note at the top of the rarity range', () => {
    const analysis = analyze('9AB* 777777');
    assert.equal(analysis.rarityScore, 1);
  });

  it('returns an empty date list rather than inventing a date', () => {
    const analysis = analyze('9AB 320892');
    assert.deepEqual(analysis.dates, []);
    assert.equal(analysis.bestDate, null);
  });

  it('returns null when the serial cannot be parsed', () => {
    assert.equal(analyzeSerial('HELLO', { now: NOW }), null);
  });

  it('surfaces OCR repair warnings for the seller to confirm', () => {
    const analysis = analyze('9AB 15O892', { repairOcrConfusions: true });
    assert.equal(analysis.serial.serialDigits, '150892');
    assert.equal(analysis.warnings.length, 1);
    assert.equal(analysis.bestDate?.iso, '1992-08-15');
  });

  it('honours an injected clock throughout', () => {
    const analysis = analyzeSerial('9AB 150822', { now: new Date('2100-01-01T00:00:00Z') });
    assert.ok(analysis !== null);
    const match = analysis.dates.find((entry) => entry.iso === '2022-08-15');
    assert.equal(match?.era, 'modern');
  });

  it('accepts separate date and pattern configs', () => {
    const analysis = analyze('9AB 010203', {
      dateConfig: { patternPriors: { DDMMYY: 0.4, MMDDYY: 1.0 } },
      patternConfig: { weights: { SEMI_FANCY: 0.05 } },
    });
    assert.equal(analysis.bestDate?.iso, '2003-01-02');
  });
});
