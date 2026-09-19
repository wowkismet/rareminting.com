import Image from 'next/image';

/**
 * The Rare Minting wordmark.
 *
 * The supplied lockup: the crowned name over its flourish rule, in white,
 * which is what the navy masthead it sits on wants.
 *
 * It replaced a typed version — Playfair capitals with a tagline under them —
 * which existed because the mark before that was a 2MB PNG that got clipped on
 * a narrow screen. Neither of those faults applies here. The artwork is
 * trimmed of its transparent margin, so the box it occupies is the mark and
 * not the canvas it was drawn on, and it is 31KB, which is less than the
 * typeface the typed version needed.
 *
 * Sized by height and never by width. A masthead is a horizontal band with a
 * fixed height, so height is the dimension that has to behave; the width
 * follows from the aspect ratio, which is why `w-auto` is here rather than a
 * second breakpoint list to keep in step with the first.
 *
 * The name is also given as text for anything that cannot see the image — a
 * screen reader, a search engine, a mail client stripping images. A logo that
 * is only a picture is a site whose name is invisible to all three.
 */

/** Trimmed artwork, 800x290. Kept here so the ratio and the file agree. */
const WIDTH = 800;
const HEIGHT = 290;

export function Wordmark() {
  return (
    <Image
      src="/wordmark.webp"
      alt="Rareminting"
      width={WIDTH}
      height={HEIGHT}
      // In the masthead on every page, so it is never below the fold and
      // never wants lazy loading.
      priority
      // Without this Next assumes the mark could fill the viewport and serves
      // a 1920px file for something drawn 132px wide. These are the two real
      // widths: 36px tall on a phone and 48px from sm, times the 2.759 ratio.
      sizes="(min-width: 640px) 132px, 99px"
      // Fine serifs and a hairline flourish: the default 75 frays both.
      quality={90}
      className="h-9 w-auto sm:h-12"
    />
  );
}
