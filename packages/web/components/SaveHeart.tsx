import { removeFromSaved, saveForLater } from '@/app/actions.ts';

/**
 * The heart on a listing card.
 *
 * A sibling of the card's link rather than a child of it: a button inside an
 * anchor is invalid, and browsers resolve the ambiguity differently, so the
 * card is positioned and the heart sits above it.
 *
 * Saving does not reserve anything. The note stays on the market and somebody
 * else can still buy it, which is why the saved list says so on each line
 * rather than quietly going stale.
 */
export function SaveHeart({
  listingId,
  saved,
  from,
}: {
  listingId: string;
  saved: boolean;
  /** Path to redraw afterwards, or the heart springs back to empty. */
  from: string;
}) {
  return (
    <form action={saved ? removeFromSaved : saveForLater} className="absolute right-3 top-3 z-10">
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="from" value={from} />
      <button
        type="submit"
        aria-label={saved ? 'Remove from saved' : 'Save for later'}
        title={saved ? 'Remove from saved' : 'Save for later'}
        className={
          saved
            ? 'flex h-8 w-8 items-center justify-center rounded-full border border-accent-deep/40 bg-sand-raised text-sm text-ember shadow-sm transition-colors hover:bg-sand'
            : 'flex h-8 w-8 items-center justify-center rounded-full border border-sand-line bg-sand-raised/90 text-sm text-slate-dim shadow-sm transition-colors hover:border-accent-deep hover:text-ember'
        }
      >
        <span aria-hidden>{saved ? '♥' : '♡'}</span>
      </button>
    </form>
  );
}
