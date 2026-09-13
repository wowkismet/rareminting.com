import Image from 'next/image';

/**
 * The Rare Minting logo.
 *
 * The supplied lockup: a modelled gold crown over the wordmark, with the
 * flourish and rule beneath, on a transparent ground so it sits on the deep
 * green without a box behind it.
 *
 * The alpha channel is reconstructed rather than original. The artwork was
 * handed over flattened — the grey-and-white chequer an editor draws *behind*
 * a transparent image had been baked into the pixels, which on the brand green
 * would have read as a white box around the mark. Recovering the transparency
 * needed more care than a colour key: at their brightest the gold's specular
 * highlights are as white and as neutral as a chequer square, so keying on
 * colour alone punched holes through the crown. What separates them is that a
 * chequer region contains both of its two tones and a highlight is a single
 * bright smear, so each enclosed light region was judged on its own and kept
 * if it was one-toned.
 *
 * That means this file is a derivation, not a master. If the original
 * transparent export turns up it should replace this outright — a
 * reconstruction is only ever as good as its guesses about the edges.
 *
 * `next/image` serves it resized and in a modern format per device, which
 * matters here: the source is a 2048px master and no visitor needs that.
 *
 * Sizes are widths rather than heights because the lockup is wide (2.7:1);
 * capping the width is what stops it dominating a narrow screen.
 */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const width =
    size === 'lg' ? 'w-[280px] sm:w-[420px]' : size === 'sm' ? 'w-[150px] sm:w-[180px]' : 'w-[200px] sm:w-[260px]';

  return (
    <Image
      src="/rare-minting-logo-crown.png"
      alt="Rare Minting"
      width={2048}
      height={768}
      priority
      sizes={size === 'lg' ? '420px' : size === 'sm' ? '180px' : '260px'}
      className={`h-auto ${width}`}
    />
  );
}
