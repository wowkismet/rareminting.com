/**
 * The wordmark, set as type rather than as an image.
 *
 * Bold italic Playfair Display: a Didone with genuinely drawn italic
 * letterforms, so the curves are cut into the face rather than a slant applied
 * to an upright. In cream on the deep green, which is the brand pairing.
 *
 * Type rather than a PNG means it stays crisp at any size, needs no download,
 * is selectable, and reads correctly to a screen reader without alt text.
 */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const scale =
    size === 'lg'
      ? 'text-5xl sm:text-6xl'
      : size === 'sm'
        ? 'text-xl'
        : 'text-2xl sm:text-3xl';

  return (
    <span
      className={`font-display font-bold italic text-cream ${scale} leading-none tracking-[0.06em]`}
    >
      RAREMINTING
    </span>
  );
}
