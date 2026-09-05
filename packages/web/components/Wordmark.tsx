import Image from 'next/image';

/**
 * The Rare Minting logo.
 *
 * The lockup in antique gold (#c9a84c, the accent token): crown over the M,
 * wordmark, and the rule beneath, on a transparent ground so it sits on the
 * deep green without a box behind it.
 *
 * Recoloured from the white master rather than redrawn, so the alpha — and
 * with it the glow and every anti-aliased edge — is exactly the artwork's own.
 * Only the interior shading is scaled; the body of the mark is the brand hex
 * to the byte. The flat colour also compresses to a quarter of the white
 * version's size.
 * `next/image` serves it resized and in a modern format per device, which
 * matters here — the source is a 2048px master and no visitor needs that.
 *
 * Sizes are widths rather than heights because the lockup is wide (2.7:1);
 * capping the width is what stops it dominating a narrow screen. The previous
 * gold artwork was 3:1, so these widths give very slightly more height than
 * before.
 *
 * The artwork carries a soft glow, which is deliberate — it is what lifts a
 * white mark off the dark green rather than letting it sit flat on it.
 */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const width =
    size === 'lg' ? 'w-[280px] sm:w-[420px]' : size === 'sm' ? 'w-[150px] sm:w-[180px]' : 'w-[200px] sm:w-[260px]';

  return (
    <Image
      src="/rare-minting-logo-gold.png"
      alt="Rare Minting"
      width={2048}
      height={768}
      priority
      sizes={size === 'lg' ? '420px' : size === 'sm' ? '180px' : '260px'}
      className={`h-auto ${width}`}
    />
  );
}
