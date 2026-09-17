import type { ReactNode } from 'react';

/**
 * The Frame & Gift banner, for the floor.
 *
 * A recreation of the supplied artwork in the site's own palette: the green
 * and gold of the original become navy, electric blue and cyan, because a
 * green band in the middle of a navy page reads as a third-party advertisement
 * rather than as part of the shop.
 *
 * The picture frame itself is deliberately NOT recoloured. It was asked to
 * stay, and it should: it is the one element depicting a physical object the
 * customer receives, and a cyan moulding would be a picture of a frame nobody
 * is selling. Dark walnut with a gilt inner lip, as in the original.
 *
 * Built in CSS rather than shipped as an image. The original is a 2000px
 * composite; at banner size on a phone almost none of that detail survives,
 * and it would be the single heaviest thing on the home page. This version
 * weighs nothing, stays sharp at any density, reflows on a narrow screen
 * instead of being letterboxed, and every word in it is real text a search
 * engine and a screen reader can read.
 *
 * The portrait slot is a generic silhouette. The original artwork used a
 * recognisable public figure, which is somebody's likeness and not ours to
 * publish — the compliance record already treats publicity rights as
 * something this site models rather than assumes.
 */

/**
 * The portrait in the frame.
 *
 * Null ships a silhouette marked "your photo". Set it to a path under
 * `public/` — `'/gift-portrait.jpg'` — and that image appears instead, with
 * no other change needed.
 *
 * It is a switch rather than a hard-coded image because of who can lawfully
 * go in that slot. A recognisable living person on a banner selling something
 * is an implied endorsement, and in India that is personality-rights
 * territory: the Delhi High Court has granted injunctions on exactly this,
 * and components/FamousDates.tsx already records the same decision for the
 * same reason. So the person here is either somebody whose likeness this
 * business holds a release for, a model shot it has licensed, or nobody.
 *
 * Whoever sets this is asserting the first two. The default asserts the third.
 */
const PORTRAIT_SRC: string | null = null;

/**
 * The finished banner artwork, if there is one.
 *
 * Null renders the built version below — the composition in markup, which
 * needs no asset and reflows on a narrow screen. Set this to a path under
 * `public/` and that image is shown instead, with the two buttons beneath it.
 *
 * Supplied artwork wins when it exists, because a designed composite carries
 * photography and depth that CSS gradients only approximate. What it does not
 * carry is text a screen reader or a search engine can read, or type that
 * stays legible at 380px — so the feature row is still rendered as real text
 * underneath rather than left to the version baked into the picture.
 *
 * Whoever sets this is asserting the business may publish everything in the
 * frame, the likeness included. See PORTRAIT_SRC above for why that matters.
 */
const BANNER_SRC: string | null = null;

/** Description for anyone who cannot see the artwork. */
const BANNER_ALT =
  'A framed Indian banknote beside a photograph and a birthday message, with a Rareminting gift box.';

/**
 * The example in the frame: a note whose serial reads as a date.
 *
 * A date, not a denomination, because that is the entire product. The
 * eleventh of October 1942 is a real date a visitor can search — /?date= it
 * and the engine returns every note whose serial spells it.
 *
 * A date carries no personality claim; a name and a face do. So the date is
 * the specific thing here and the recipient is left as the buyer's own, which
 * is also what the frame will actually say when somebody buys one.
 */
const EXAMPLE = {
  serial: '11 101942',
  pretty: '11 October 1942',
  iso: '1942-10-11',
  series: 'Mahatma Gandhi Series',
  recipient: 'Papa',
} as const;

const FEATURES: readonly { icon: ReactNode; head: string; sub: string }[] = [
  {
    head: 'Premium',
    sub: 'Framing options',
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="1.5" />
        <path d="M6 16l3.5-4 2.5 2.8L15 11l3 5" />
        <circle cx="9" cy="9.5" r="1.2" />
      </>
    ),
  },
  {
    head: 'Personalised',
    sub: 'Messages & photos',
    icon: (
      <>
        <path d="M4 20l1-4L16 5a2 2 0 0 1 3 3L8 19z" />
        <path d="M14 7l3 3" />
      </>
    ),
  },
  {
    head: 'Luxury gift',
    sub: 'Packaging',
    icon: (
      <>
        <rect x="3" y="10" width="18" height="10" rx="1" />
        <path d="M3 10h18M12 10v10" />
        <path d="M12 10S9 4 6.5 5.5 9.5 10 12 10zM12 10s3-6 5.5-4.5S14.5 10 12 10z" />
      </>
    ),
  },
  {
    head: 'Secure',
    sub: 'Delivery',
    icon: (
      <>
        <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
  },
  {
    head: 'Authentic',
    sub: 'Rare notes',
    icon: (
      <>
        <path d="M12 3l4 4-4 14-4-14z" />
        <path d="M8 7h8" />
      </>
    ),
  },
  {
    head: 'A timeless gift',
    sub: 'Of value',
    icon: (
      <>
        <path d="M4 8l3.5 3L12 5l4.5 6L20 8l-1.5 10h-13z" />
        <path d="M5.5 20h13" />
      </>
    ),
  },
];

export function GiftBanner() {
  return (
    <section
      aria-labelledby="gift-banner-heading"
      className="overflow-hidden rounded-sm border border-line bg-ink"
    >
      <h2 id="gift-banner-heading" className="sr-only">
        Frame and gift a banknote
      </h2>

      {BANNER_SRC === null ? <BuiltBanner /> : <Artwork />}

      <Features />

      {/* ---------- The two ways in ----------
          Two buttons because the service is two things people arrive wanting.
          Some are shopping for the note and will write something once they
          have it; others already know what they want to say and need a note
          to say it on. Both land in the same place eventually, but being told
          only "frame a note" leaves the second sort thinking the message is
          somebody else's product. */}
      <div className="flex flex-wrap items-center justify-center gap-3 border-t border-line bg-ink px-6 py-6">
        <a
          href="/browse"
          className="rounded-full bg-secondary px-8 py-3 text-sm font-medium text-cream transition-colors hover:bg-accent hover:text-primary"
        >
          Frame a note
        </a>
        <a
          href="/cart"
          className="rounded-full border border-accent px-8 py-3 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-primary"
        >
          Add a message
        </a>
        <p className="w-full text-center text-xs text-cream-dim sm:w-auto sm:text-left">
          Choose a frame, write the card, and we print and post it.
        </p>
      </div>
    </section>
  );
}

/**
 * The supplied artwork.
 *
 * Unoptimised is deliberate: this is a photographic composite whose value is
 * its depth and grain, and Next's default quality visibly muddies the note
 * and the gilt. It is one request on one page, and the alternative — a banner
 * that looks cheap — costs more than the bytes.
 *
 * The feature row still renders as text beneath it. The artwork has its own
 * baked in, but baked-in type is unreadable at 380px and invisible to a
 * screen reader, so the words exist twice on purpose.
 */
function Artwork() {
  return (
    <img
      src={BANNER_SRC ?? ''}
      alt={BANNER_ALT}
      className="w-full"
      loading="lazy"
      decoding="async"
    />
  );
}

/** The composition in markup, used until artwork is supplied. */
function BuiltBanner() {
  return (
    <>
      <div className="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,14rem)] lg:gap-10">
        {/* ---------- The mark, and the promise ---------- */}
        <div className="text-center lg:text-left">
          <Monogram />
          <p className="mt-4 font-display text-2xl font-semibold uppercase leading-none tracking-[0.12em] text-accent sm:text-3xl">
            Rareminting
          </p>
          <p className="mt-3 font-display text-[11px] uppercase leading-relaxed tracking-[0.22em] text-accent-bright">
            Rare is not expensive,
            <br />
            it&rsquo;s priceless
          </p>
        </div>

        {/* ---------- The framed piece ---------- */}
        <FramedPiece />

        {/* ---------- The gift box ---------- */}
        <div className="flex flex-col items-center gap-5">
          <GiftBox />
          <p className="text-center font-display text-lg italic leading-snug text-accent-bright">
            A rare gift
            <br />
            for a rare soul
          </p>
          <a
            href={`/?date=${EXAMPLE.iso}`}
            className="rounded-full bg-secondary px-7 py-2.5 text-xs font-medium text-cream transition-colors hover:bg-accent hover:text-primary"
          >
            Find a date
          </a>
        </div>
      </div>
    </>
  );
}

/**
 * What comes with it, as text.
 *
 * Rendered whichever banner is showing. The supplied artwork has this row
 * baked into the picture, but type inside an image is unreadable on a phone
 * and invisible to a screen reader and a search engine — so the words exist
 * twice, and only one of the two can be read by everyone.
 */
function Features() {
  return (
      <div className="border-t border-line bg-primary">
        <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6">
          {FEATURES.map((f) => (
            <li
              key={f.head}
              className="flex items-center justify-center gap-3 px-3 py-5 text-center lg:flex-row lg:text-left"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="h-7 w-7 shrink-0 text-accent"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {f.icon}
              </svg>
              <span className="min-w-0">
                <span className="block text-xs font-medium leading-tight text-cream">{f.head}</span>
                <span className="block text-[11px] leading-tight text-cream-dim">{f.sub}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
  );
}

/** The RM monogram, in the site's cyan rather than the original's gold. */
function Monogram() {
  return (
    <svg
      viewBox="0 0 120 92"
      aria-hidden
      className="mx-auto h-16 w-auto text-accent lg:mx-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      {/* The laurel, as two sweeps rather than drawn leaf by leaf — at this
          size the individual leaves of the original close into a line. */}
      <path d="M46 78C26 72 16 56 18 36" />
      <path d="M74 78c20-6 30-22 28-42" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i} opacity={0.85}>
          <path d={`M${20 + i * 3.4} ${38 + i * 7}c-5-3-7-7-6-11`} />
          <path d={`M${100 - i * 3.4} ${38 + i * 7}c5-3 7-7 6-11`} />
        </g>
      ))}
      {/* The crown. */}
      <path d="M46 24l6 7 8-11 8 11 6-7v10H46z" />
      <circle cx="46" cy="21" r="2" />
      <circle cx="60" cy="16" r="2.4" />
      <circle cx="74" cy="21" r="2" />
      {/* RM, set rather than drawn — a real glyph beats an approximation. */}
      <text
        x="60"
        y="66"
        textAnchor="middle"
        fontFamily="var(--font-display), Georgia, serif"
        fontSize="34"
        fontWeight="600"
        letterSpacing="1"
        fill="currentColor"
        stroke="none"
      >
        RM
      </text>
    </svg>
  );
}

/**
 * The frame.
 *
 * The one thing kept in the original's colours. Layers, outside in: walnut
 * moulding, a gilt lip, then the navy mount the pieces are laid on. The
 * moulding is a repeating gradient rather than a flat brown so it reads as
 * turned wood at a glance without anybody having to photograph one.
 */
function FramedPiece() {
  return (
    <div
      className="mx-auto w-full max-w-2xl rounded-[3px] p-[14px] shadow-2xl sm:p-[18px]"
      style={{
        background:
          'linear-gradient(145deg,#6b4423 0%,#3f2616 18%,#2a180d 40%,#4a2c19 62%,#7a5230 82%,#33200f 100%)',
        boxShadow: '0 20px 50px -12px rgba(0,0,0,.75), inset 0 0 0 1px rgba(0,0,0,.4)',
      }}
    >
      {/* The gilt lip between moulding and mount. */}
      <div
        className="rounded-[2px] p-[3px]"
        style={{
          background: 'linear-gradient(135deg,#e6c072 0%,#a9812f 38%,#f0d89a 58%,#8a6620 100%)',
        }}
      >
        <div className="rounded-[1px] bg-ink p-3 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)_minmax(0,1.3fr)] sm:gap-4">
            {/* --- The note, and the date its serial reads as --- */}
            <div className="flex flex-col gap-2">
              <NotePlaceholder />
              {/* The caption is the date rather than the denomination. The
                  denomination is the least interesting thing about this note;
                  what it is being sold for is that its serial spells a day. */}
              <div className="rounded-[2px] border border-accent/30 px-2 py-1 text-center">
                <p className="font-listing text-[12px] leading-tight text-accent-bright">
                  {EXAMPLE.pretty}
                </p>
                <p className="text-[8px] uppercase tracking-[0.18em] text-cream-dim">
                  Serial {EXAMPLE.serial} · {EXAMPLE.series}
                </p>
              </div>
            </div>

            {/* --- Their photograph --- */}
            <div
              className="overflow-hidden rounded-[2px] border border-accent/40 p-[3px]"
              style={{ aspectRatio: '3 / 4' }}
            >
              {PORTRAIT_SRC === null ? (
                <PortraitPlaceholder />
              ) : (
                <img
                  src={PORTRAIT_SRC}
                  alt=""
                  className="h-full w-full rounded-[1px] object-cover"
                />
              )}
            </div>

            {/* --- The message --- */}
            <div className="flex flex-col justify-center rounded-[2px] border border-accent/30 px-3 py-3 text-center">
              <p className="font-display text-[13px] font-semibold leading-tight text-accent-bright">
                Happy Birthday,
                <br />
                {EXAMPLE.recipient}!
              </p>
              <p className="mx-auto mt-2 max-w-[24ch] text-[9px] leading-relaxed text-cream-dim">
                May your life always be filled with good health, happiness and continued
                inspiration. You remain an icon, not just on screen, but in our hearts.
              </p>
              <p className="mt-2 text-[9px] italic leading-tight text-cream-dim">
                With admiration &amp; love,
                <br />
                from your well wisher
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A banknote, suggested rather than depicted.
 *
 * Deliberately not a real scan. Reproducing currency artwork on a marketing
 * banner is a reproduction question nobody needs to answer, and a specific
 * note here would also promise a specific note in the box.
 */
function NotePlaceholder() {
  return (
    <div
      className="w-full overflow-hidden rounded-[2px] border border-accent/25"
      style={{ aspectRatio: '2.2 / 1' }}
    >
      <svg viewBox="0 0 220 100" className="h-full w-full" role="img" aria-label="A banknote">
        <rect width="220" height="100" fill="#0d2740" />
        <rect x="5" y="5" width="210" height="90" fill="none" stroke="#20c4f4" strokeOpacity=".35" />
        <text x="16" y="34" fontFamily="var(--font-display), serif" fontSize="22" fill="#7ddcfb">
          100
        </text>
        <text
          x="16"
          y="86"
          fontFamily="ui-monospace, monospace"
          fontSize="13"
          letterSpacing="1.5"
          fill="#20c4f4"
        >
          {EXAMPLE.serial}
        </text>
        {/* The portrait medallion, as a disc. */}
        <circle cx="163" cy="50" r="27" fill="#123753" stroke="#20c4f4" strokeOpacity=".4" />
        <circle cx="163" cy="42" r="9" fill="#1b4f74" />
        <path d="M148 66c2-9 8-13 15-13s13 4 15 13z" fill="#1b4f74" />
        <text
          x="16"
          y="98"
          fontFamily="var(--font-ui), system-ui, sans-serif"
          fontSize="8"
          letterSpacing="1"
          fill="#7ddcfb"
        >
          reads {EXAMPLE.pretty}
        </text>
        {/* Guilloche, suggested with three arcs. */}
        {[0, 1, 2].map((i) => (
          <path
            key={i}
            d={`M14 ${46 + i * 6}q46 ${14 - i * 5} 92 0`}
            fill="none"
            stroke="#20c4f4"
            strokeOpacity={0.18}
          />
        ))}
      </svg>
    </div>
  );
}

/** The recipient's photograph slot, as a silhouette. */
function PortraitPlaceholder() {
  return (
    <svg
      viewBox="0 0 90 120"
      className="h-full w-full rounded-[1px]"
      role="img"
      aria-label="Where your photograph goes"
    >
      <rect width="90" height="120" fill="#123753" />
      <circle cx="45" cy="44" r="19" fill="#20c4f4" fillOpacity=".55" />
      <path d="M10 120c0-22 16-36 35-36s35 14 35 36z" fill="#20c4f4" fillOpacity=".4" />
      <text
        x="45"
        y="112"
        textAnchor="middle"
        fontFamily="var(--font-ui), system-ui, sans-serif"
        fontSize="7"
        letterSpacing="1"
        fill="#9cb3c9"
      >
        YOUR PHOTO
      </text>
    </svg>
  );
}

/** The presentation box, in the site's blues with a cyan ribbon. */
function GiftBox() {
  return (
    <svg
      viewBox="0 0 160 130"
      aria-hidden
      className="h-32 w-auto"
      style={{ filter: 'drop-shadow(0 14px 26px rgba(0,0,0,.6))' }}
    >
      <defs>
        <linearGradient id="giftbox-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#123753" />
          <stop offset="55%" stopColor="#071a2b" />
          <stop offset="100%" stopColor="#0d2740" />
        </linearGradient>
        <linearGradient id="giftbox-lid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1b4f74" />
          <stop offset="60%" stopColor="#0d2740" />
          <stop offset="100%" stopColor="#123753" />
        </linearGradient>
        <linearGradient id="giftbox-ribbon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7ddcfb" />
          <stop offset="50%" stopColor="#20c4f4" />
          <stop offset="100%" stopColor="#0b5cff" />
        </linearGradient>
      </defs>

      <rect x="18" y="46" width="124" height="74" rx="3" fill="url(#giftbox-body)" />
      <rect x="12" y="32" width="136" height="20" rx="3" fill="url(#giftbox-lid)" />
      {/* Ribbon down the box and across the lid. */}
      <rect x="72" y="32" width="16" height="88" fill="url(#giftbox-ribbon)" opacity=".92" />
      <rect x="12" y="38" width="136" height="8" fill="url(#giftbox-ribbon)" opacity=".75" />
      {/* Bow. */}
      <path
        d="M80 34c-13-4-26-14-22-22 3-7 16-2 22 22zM80 34c13-4 26-14 22-22-3-7-16-2-22 22z"
        fill="url(#giftbox-ribbon)"
      />
      <circle cx="80" cy="33" r="5" fill="#7ddcfb" />
      {/* The mark on the lid face. */}
      <text
        x="80"
        y="86"
        textAnchor="middle"
        fontFamily="var(--font-display), Georgia, serif"
        fontSize="15"
        fontWeight="600"
        letterSpacing="2"
        fill="#20c4f4"
      >
        RM
      </text>
      <text
        x="80"
        y="100"
        textAnchor="middle"
        fontFamily="var(--font-display), Georgia, serif"
        fontSize="6.5"
        letterSpacing="2.4"
        fill="#9cb3c9"
      >
        RAREMINTING
      </text>
    </svg>
  );
}
