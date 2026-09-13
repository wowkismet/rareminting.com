import { api } from '@/lib/api.ts';

/**
 * Whatever staff have scheduled for a named position.
 *
 * Renders nothing at all when the slot is empty, so a page with no banner has
 * no gap where one would be — an empty box with a border is worse than no box.
 *
 * Two kinds of banner, and the difference matters.
 *
 * A banner *we* typeset carries a headline as real text over a photograph.
 * Type baked into an image cannot be read aloud, does not survive a slow
 * connection, is invisible to a search engine and cannot reflow on a phone,
 * and a good many buyers arrive on one.
 *
 * A banner that is *finished artwork* carries no headline at all. Laying our
 * own heading and a darkening scrim over a designed piece damages the thing
 * we were handed, and cropping it to fit a fixed box throws away the edges it
 * was composed around. So when there is no headline the image is rendered
 * whole: its own aspect ratio, nothing over it, nothing cut off.
 */

interface Banner {
  id: string;
  /** Null when the artwork carries its own words. */
  headline: string | null;
  subtext: string | null;
  href: string | null;
  ctaLabel: string | null;
  imageUrl: string | null;
  altText: string | null;
}

export async function BannerSlot({ slot, className }: { slot: string; className?: string }) {
  // Cached briefly: this sits on the homepage, so it must not be a database
  // round trip per visitor, and a banner appearing a minute late is nobody's
  // emergency.
  const result = await api<{ banners: Banner[] }>(`/v1/banners?slot=${slot}`, { revalidate: 60 });
  const banner = result.ok ? result.data.banners[0] : undefined;
  if (banner === undefined) return null;

  // Artwork on its own. No box, no border, no scrim, no words — the image at
  // its own aspect ratio, complete on every screen. `h-auto` with no fixed
  // height is what guarantees nothing is cropped: the container takes the
  // shape of the picture rather than the picture being cut to fit a container.
  if (banner.headline === null && banner.imageUrl !== null) {
    const art = (
      <img
        src={banner.imageUrl}
        alt={banner.altText ?? ''}
        className="block h-auto w-full rounded-sm"
      />
    );
    return banner.href === null ? (
      <div className={className ?? ''}>{art}</div>
    ) : (
      <a href={banner.href} className={`block ${className ?? ''} transition-opacity hover:opacity-95`}>
        {art}
      </a>
    );
  }

  const body = (
    <div className="relative isolate overflow-hidden rounded-sm border border-line bg-primary">
      {banner.imageUrl !== null && (
        <>
          <img
            src={banner.imageUrl}
            alt={banner.altText ?? ''}
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
          {/* The scrim is what keeps the headline legible whatever the image
              turns out to be — staff choose the picture, not the contrast. */}
          <div aria-hidden className="absolute inset-0 -z-10 bg-ink/60" />
        </>
      )}

      <div className="flex flex-col items-start gap-3 px-6 py-8 sm:px-10 sm:py-12">
        <p className="max-w-2xl font-display text-2xl leading-tight text-cream sm:text-3xl">
          {banner.headline}
        </p>
        {banner.subtext !== null && (
          <p className="max-w-xl text-sm leading-relaxed text-cream-dim">{banner.subtext}</p>
        )}
        {banner.href !== null && banner.ctaLabel !== null && (
          <span className="mt-1 inline-block rounded-full bg-accent px-5 py-2 text-sm font-medium text-ink">
            {banner.ctaLabel}
          </span>
        )}
      </div>
    </div>
  );

  const wrapper = className === undefined ? '' : className;

  // Wrapped in a link only when there is somewhere to go. A banner that looks
  // clickable and is not is worse than one that plainly is not.
  return banner.href === null ? (
    <div className={wrapper}>{body}</div>
  ) : (
    <a href={banner.href} className={`block ${wrapper} transition-opacity hover:opacity-95`}>
      {body}
    </a>
  );
}
