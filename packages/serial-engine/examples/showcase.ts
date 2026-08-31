/**
 * Runnable showcase: `node examples/showcase.ts`
 *
 * Prints how the engine reads the serials named in the product brief. Handy for
 * eyeballing behaviour changes when tuning config weights.
 */

import { analyzeSerial } from '../src/index.ts';

const NOW = new Date('2026-08-31T00:00:00Z');

const SAMPLES: readonly { serial: string; note: string }[] = [
  { serial: '9AB 150892', note: 'a birthday — 15 Aug 1992' },
  { serial: '9AB 250199', note: 'an anniversary — 25 Jan 1999' },
  { serial: '9AB 021069', note: "the brief calls this Gandhi's date of birth" },
  { serial: '9AB 150847', note: 'Independence Day' },
  { serial: '9AB* 777777', note: 'solid, star series' },
  { serial: '9AB 123321', note: 'radar' },
  { serial: '9AB 000001', note: 'lowest serial' },
  { serial: '9AB 000786', note: 'lucky 786' },
  { serial: '9AB 101101', note: 'radar + repeater + binary' },
  { serial: '9AB 290200', note: '29 Feb 2000 — a real leap day' },
  { serial: '9AB 290201', note: '29 Feb 2001 — not a leap day' },
  { serial: '9AB 320892', note: 'impossible date' },
];

for (const sample of SAMPLES) {
  const analysis = analyzeSerial(sample.serial, { now: NOW });
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`${sample.serial}   (${sample.note})`);

  if (analysis === null) {
    console.log('  UNPARSEABLE');
    continue;
  }

  const tags = analysis.patterns.map((tag) => `${tag.code}(${tag.weight.toFixed(2)})`);
  console.log(`  rarity ${analysis.rarityScore.toFixed(3)}   tags: ${tags.join(' ') || 'none'}`);

  if (analysis.dates.length === 0) {
    console.log('  dates: none — no valid reading');
    continue;
  }
  for (const date of analysis.dates) {
    const era = date.era ?? 'partial';
    console.log(
      `  ${date.iso.padEnd(12)} ${(date.confidence * 100).toFixed(1).padStart(5)}%  ` +
        `score ${date.score.toFixed(3)}  ${era.padEnd(9)} [${date.patterns.join(', ')}]`,
    );
  }
}
console.log();
