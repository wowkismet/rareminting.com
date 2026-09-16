/**
 * The Rare Minting wordmark.
 *
 * Set as text rather than served as an image. The previous mark was a 2MB
 * rendered PNG of a crowned lockup; at masthead size almost none of that
 * modelling survived, and on a narrow screen the image was the widest thing
 * in the header and the first to be clipped.
 *
 * Text costs nothing to download, is sharp at every density without a srcset,
 * can be selected and read aloud, and is what a search engine indexes as the
 * site's name. It also cannot be cut off, because it wraps and scales like
 * everything else around it.
 *
 * In the accent cyan — the same colour as the buttons — so the masthead has
 * one bright note in it rather than two competing ones. The capitals are
 * tracked out because a word set solid in caps at this size closes up and
 * reads as a block rather than as a name.
 *
 * The old artwork is still in public/ if it is ever wanted back.
 */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const scale =
    size === 'lg'
      ? 'text-4xl sm:text-6xl'
      : size === 'sm'
        ? 'text-xl sm:text-2xl'
        : 'text-2xl sm:text-3xl';

  return (
    <span
      className={`font-display font-semibold uppercase leading-none tracking-[0.12em] text-accent ${scale}`}
    >
      Rareminting
    </span>
  );
}
