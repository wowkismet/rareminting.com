import Image from 'next/image';

/**
 * The Rare Minting logo.
 *
 * The supplied artwork: gold and green with the crown over the M, on a
 * transparent ground so it sits on the deep green without a white box.
 * `next/image` serves it resized and in a modern format per device.
 *
 * Sizes are widths rather than heights because the lockup is very wide (3.5:1);
 * capping the width is what stops it dominating a narrow screen.
 */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const width =
    size === 'lg' ? 'w-[280px] sm:w-[420px]' : size === 'sm' ? 'w-[150px] sm:w-[180px]' : 'w-[200px] sm:w-[260px]';

  return (
    <Image
      src="/rare-minting-logo.png"
      alt="Rare Minting"
      width={2171}
      height={724}
      priority
      sizes={size === 'lg' ? '420px' : size === 'sm' ? '180px' : '260px'}
      className={`h-auto ${width}`}
    />
  );
}
