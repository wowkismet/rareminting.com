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
 * Both lines are Playfair Display, the display face. The tagline is set much
 * smaller and tracked out hard, so it reads as a rule under the name rather
 * than competing with it — a tagline at anything near the name's weight turns
 * a wordmark into a sentence.
 *
 * One size, everywhere. It was previously three, chosen per placement, which
 * meant the mark was a different size on the home page than in the dashboard
 * and the site never quite looked like one site. The two-step responsive
 * bump is not a second size: it is this size, on a phone.
 *
 * In the accent cyan — the same colour as the buttons — so the masthead has
 * one bright note in it rather than two competing ones.
 *
 * The old artwork is still in public/ if it is ever wanted back.
 */
export function Wordmark() {
  return (
    <span className="inline-flex flex-col leading-none">
      <span className="font-display text-2xl font-semibold uppercase leading-none tracking-[0.12em] text-accent sm:text-3xl">
        Rareminting
      </span>
      <span className="mt-1 font-display text-[9px] uppercase leading-none tracking-[0.34em] text-accent/70 sm:text-[10px]">
        Tells your story
      </span>
    </span>
  );
}
