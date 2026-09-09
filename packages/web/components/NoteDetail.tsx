import { formatDayFirst } from '@/lib/search.ts';

/**
 * What this note actually is, written out.
 *
 * Sellers write a line or two, or nothing at all. That is not enough for
 * somebody deciding whether to spend twenty thousand rupees, and it is not
 * enough for a search engine either — a page whose only prose is "nice note"
 * does not rank for anything.
 *
 * So this composes a real account from facts the site already holds: the
 * denomination and series, the prefix and whether it is a replacement, the
 * grade and what that grade means, every date the serial reads as, and the
 * patterns the engine found in it. Nothing here is invented — every sentence
 * is derived from a column — which is why it can be shown without a seller
 * having written a word.
 *
 * The seller's own description comes first where there is one. Theirs is the
 * part a buyer most wants; this is the part that makes the page worth reading
 * when they have not bothered.
 */

const GRADE_MEANING: Record<string, string> = {
  UNC: 'uncirculated — as it left the press, with no fold, crease or handling',
  AU: 'about uncirculated — crisp, with at most the faintest evidence of handling',
  XF: 'extremely fine — bright and firm, with perhaps one light fold',
  VF: 'very fine — clearly circulated but sound, with some folds and honest wear',
  F: 'fine — well circulated, with rounding at the corners and softened paper',
  VG: 'very good — heavily circulated, intact but plainly used',
  G: 'good — much worn, complete, and collected for the number rather than the paper',
  POOR: 'poor — the number is the point; the paper has had a long life',
};

const PATTERN_MEANING: Record<string, string> = {
  solid: 'a solid — every digit the same, and among the hardest patterns to find',
  radar: 'a radar — it reads identically backwards and forwards',
  ladder: 'a ladder — the digits run in sequence',
  repeater: 'a repeater — a block of digits repeated',
  'low-serial': 'a low serial — from the first notes of its run off the press',
  lucky: 'an auspicious number, of the kind sought as a gift',
  novelty: 'a number that reads as something in its own right',
};

interface Note {
  denomination: number;
  series: string;
  prefix: string | null;
  isStar: boolean;
  serialDigits: string;
}

interface DateReading {
  iso: string | null;
  day: number;
  month: number;
  isPartial: boolean;
  era: string | null;
}

export function NoteDetail({
  title,
  description,
  note,
  grade,
  dates,
  patterns,
  sellerName,
}: {
  title: string;
  description: string | null | undefined;
  note: Note | undefined;
  grade: string | null;
  dates: readonly DateReading[] | undefined;
  patterns: readonly string[] | undefined;
  sellerName?: string | undefined;
}) {
  const full = (dates ?? []).filter((d) => !d.isPartial && d.iso !== null);
  const named = (patterns ?? [])
    .map((p) => PATTERN_MEANING[p])
    .filter((p): p is string => p !== undefined);

  const written = description != null && description.trim() !== '' ? description.trim() : null;

  return (
    <section aria-labelledby="about" className="flex flex-col gap-4">
      <h2 id="about" className="font-display text-2xl text-slate">
        About this {note === undefined ? 'item' : 'note'}
      </h2>

      {written !== null && (
        <div className="rounded-sm border-l-2 border-accent-deep/40 pl-4">
          <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-slate">{written}</p>
          {sellerName !== undefined && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
              In the seller&rsquo;s words · {sellerName}
            </p>
          )}
        </div>
      )}

      {note !== undefined ? (
        <div className="flex flex-col gap-3 text-[0.95rem] leading-relaxed text-slate">
          <p>
            This is a ₹{note.denomination} note of the {note.series}, carrying the serial number{' '}
            <span className="font-mono tracking-wider">
              {note.prefix ?? ''}
              {note.prefix === null ? '' : ' '}
              {note.serialDigits}
            </span>
            {note.prefix !== null && (
              <>
                {' '}
                — the prefix <span className="font-mono">{note.prefix}</span> identifies the print
                run it came from
              </>
            )}
            .{' '}
            {note.isStar && (
              <>
                The star in the prefix marks it as a replacement note, printed to take the place of
                one spoiled during production and issued in far smaller numbers than an ordinary
                note of the same run. Collectors look for them specifically.{' '}
              </>
            )}
          </p>

          <p>
            The condition is stated by the seller as{' '}
            <strong className="font-normal text-slate">{grade ?? 'ungraded'}</strong>
            {grade !== null && GRADE_MEANING[grade] !== undefined && (
              <> — {GRADE_MEANING[grade]}</>
            )}
            . Grading on Rare Minting is the seller&rsquo;s own assessment rather than a
            certification by us, and the photographs above are the evidence: they are of this note,
            not a stock image of the type.
          </p>

          {full.length > 0 && (
            <p>
              Read as a date, the digits of this serial spell{' '}
              {full.length === 1 ? (
                <span className="font-mono">{formatDayFirst(full[0]!.iso!)}</span>
              ) : (
                <>
                  {full.length} different dates —{' '}
                  {full.slice(0, 4).map((d, i) => (
                    <span key={d.iso}>
                      {i > 0 && (i === Math.min(full.length, 4) - 1 ? ' and ' : ', ')}
                      <span className="font-mono">{formatDayFirst(d.iso!)}</span>
                    </span>
                  ))}
                  {full.length > 4 && `, among ${full.length - 4} others`}
                </>
              )}
              . That is what makes a note like this a gift rather than a purchase: somebody&rsquo;s
              birthday, an anniversary, or the day a business was founded, printed on currency years
              before it mattered to them.
            </p>
          )}

          {named.length > 0 && (
            <p>
              Beyond any date, this serial is{' '}
              {named.map((n, i) => (
                <span key={n}>
                  {i > 0 && (i === named.length - 1 ? ' and ' : ', ')}
                  {n}
                </span>
              ))}
              . Patterns of that kind are sought for their own sake, whatever date the number
              happens to spell, and every serial listed here is read for them automatically when it
              goes up.
            </p>
          )}

          <p>
            Payment for this note is held until it reaches you and the inspection window closes, so
            the seller is paid after delivery rather than before. If it arrives and the serial is
            not the one shown, or the condition is materially worse than stated, that is a claim
            rather than an argument.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-[0.95rem] leading-relaxed text-slate">
          <p>
            {title} is listed by its seller as being in{' '}
            <strong className="font-normal text-slate">{grade ?? 'unstated'}</strong> condition. The
            photographs above are of this item rather than a stock picture of the type, and are the
            evidence a buyer is asked to judge it on.
          </p>
          <p>
            Payment is held until it reaches you and the inspection window closes, so the seller is
            paid after delivery rather than before. If what arrives is not what was described, that
            is a claim rather than an argument.
          </p>
        </div>
      )}
    </section>
  );
}
