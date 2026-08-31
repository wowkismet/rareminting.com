# `@rareminting/serial-engine`

The domain core of Rare Minting: it parses a banknote serial number, reads every
plausible date out of it, and classifies it against the fancy-number taxonomy.

Pure, deterministic, zero runtime dependencies. The API service, the OCR service
and the pricing engine all consume this same library, so a serial can never be
interpreted two different ways in two different places.

```ts
import { analyzeSerial } from '@rareminting/serial-engine';

const analysis = analyzeSerial('9AB* 150892');
analysis.serial.prefix;        // '9AB'
analysis.serial.isStar;        // true
analysis.bestDate?.iso;        // '1992-08-15'
analysis.patterns.map(t => t.code);  // ['STAR_SERIES']
analysis.rarityScore;          // 0.45
```

## Running it

Requires Node 24+, which executes TypeScript directly — there is no build step.

```
npm install
npm test          # 126 tests
npm run typecheck
node examples/showcase.ts
```

## Design decisions

**Serials are decomposed, never stored as a blob.** `prefix`, `prefixNumeral`,
`prefixLetters`, `insetLetter`, `isStar` and `serialDigits` are separate fields
because every one of them is a facet buyers filter on.

**Digit blocks are strings, always.** `000001` and `1` are different notes.
`serialValue` exists for range queries only; it must never drive display.

**The date engine returns a ranked list, never one answer.** `010203` is validly
1 Feb 2003, 2 Jan 2003 and 3 Feb 2001. Each reading carries an absolute `score`
(comparable across serials, for pricing) and a normalised `confidence` (a share
of this serial's plausibility, summing to 1, for the UI).

**The clock is injectable.** Era classification depends on "now", so every
date-dependent test passes a fixed `now`. Never call these functions without it
in a test.

**Nothing is auto-corrected silently.** OCR repair is opt-in, applies only to
positions the grammar already says are digits (so the prefix `9OB` can never
become `90B`), and always emits a warning for the seller to confirm.

**Config is per-key overridable.** `DateEngineConfigOverrides` and
`PatternEngineConfigOverrides` are deeply partial, so an operator can retune a
single weight from an admin screen without restating the whole record. This is
what makes the weights tunable without a redeploy.

## Behaviour worth knowing

**Two-digit years cannot reach the 1800s.** With the default `minYear` of 1900,
`021069` resolves to 2 October **1969**, not 1869. Mahatma Gandhi (1869),
Nehru (1889) and Tagore (1861) are therefore unreachable by year from a
six-digit `DDMMYY` serial. Pre-1900 personalities have to be matched on
day-and-month, or on an eight-digit serial. See "Open questions" below.

**Partial day-month readings only appear when they add something.** For most
six-digit serials `DDMMYY` always resolves to *some* valid year, so the `DDMM`
partial would be redundant and is suppressed. It surfaces when no full reading
lands on that day and month — for example `290201`, where no valid year gives
29 February, so `--02-29` is offered on its own.

**A serial carries as many tags as it earns.** `101101` is simultaneously a
radar, a repeater and a binary. `rarityScore` collapses the list with the
strongest tag dominating, so a pile of weak tags can never outrank a solid.

**`ERROR_NOTE` is never produced here.** Printing errors are not visible in the
serial; they come from image analysis or manual review.

## Module map

| File | Responsibility |
| --- | --- |
| `types.ts` | All domain types. No logic. |
| `digits.ts` | Digit-block primitives: runs, divisors, Hamming distance, digital root. |
| `serial.ts` | Grammar-based parsing, OCR repair, the global uniqueness key. |
| `dates.ts` | Calendar validation, century resolution, ranked interpretations. |
| `patterns.ts` | Fancy taxonomy, rarity weights, distance to nearest premium pattern. |
| `pairs.ts` | Two-note lots for full `DDMMYYYY` dates. |
| `index.ts` | `analyzeSerial` and the public surface. |

## Open questions for the business

These are judgement calls, not technical ones. They are config today, so
changing them costs nothing but a decision.

1. **Pre-1900 dates.** Lowering `minYear` to 1800 would let `021069` read as
   1869 — but it would also add a second, usually-wrong 19th-century reading to
   almost every serial. The alternative is to match historic personalities on
   day-and-month only. This decision shapes the whole "Famous Politician
   Birthday Notes" category.

2. **Token contains-matching is noisy.** `000786` currently picks up a weak
   `NOVELTY` tag because `007` appears inside it. Honest, but arguably clutter
   on a product page. Setting `containsMatchFactor` to `0` restricts novelty and
   lucky tags to exact and trailing matches.

3. **Low-serial banding.** The spec's `000001–000100` is implemented as three
   tiers. Some dealers price up to `001000`; that is one added band in config.

4. **`000001` is tagged semi-fancy** for being one digit from `000000`, a serial
   that does not exist. Harmless (it is dominated by its low-serial tag) but a
   candidate for exclusion.
