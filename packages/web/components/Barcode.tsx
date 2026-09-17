import { code128 } from '@rareminting/config';

/**
 * A Code 128 barcode, drawn as SVG.
 *
 * SVG rather than a canvas or an image for one reason: this is printed. A
 * raster barcode at screen resolution scans badly off paper, and the whole
 * point of putting it on the label is that a warehouse scanner reads it on the
 * first pass. Vector bars stay crisp at whatever the printer's resolution is.
 *
 * Rendered on the server. The widths are a pure function of the text, so there
 * is nothing here that needs a browser, and a printed page should never be
 * waiting on JavaScript.
 *
 * Deliberately black on white and nothing else. A scanner needs contrast, and
 * the site's navy would cost reads for no gain — this is the one element on
 * the page that is not allowed to follow the palette.
 */
export function Barcode({
  value,
  height = 56,
  moduleWidth = 2,
  showText = true,
  className = '',
}: {
  value: string;
  /** Bar height in px. Under about 40 the read rate falls off sharply. */
  height?: number;
  /** Width of one module. Two is the minimum most scanners handle on paper. */
  moduleWidth?: number;
  showText?: boolean;
  className?: string;
}) {
  const bar = code128(value);

  // The quiet zone is not decoration: Code 128 requires at least ten clear
  // modules either side, and a scanner will simply fail to see a barcode that
  // runs up against something. This is the most common way a printed label
  // that looks fine does not work.
  const quiet = 10;
  const width = (bar.modules + quiet * 2) * moduleWidth;
  const textHeight = showText ? 14 : 0;

  const rects: { x: number; w: number }[] = [];
  let x = quiet;
  bar.widths.forEach((w, i) => {
    // Widths alternate bar, space, bar... starting with a bar.
    if (i % 2 === 0) rects.push({ x, w });
    x += w;
  });

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height + textHeight}`}
      width={width}
      height={height + textHeight}
      role="img"
      aria-label={`Barcode: ${bar.text}`}
      style={{ background: '#fff' }}
    >
      <rect x={0} y={0} width={width} height={height + textHeight} fill="#fff" />
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x * moduleWidth}
          y={0}
          width={r.w * moduleWidth}
          height={height}
          fill="#000"
        />
      ))}
      {showText && (
        <text
          x={width / 2}
          y={height + 11}
          textAnchor="middle"
          fontFamily="ui-monospace, Consolas, monospace"
          fontSize={11}
          letterSpacing={1}
          fill="#000"
        >
          {bar.text}
        </text>
      )}
    </svg>
  );
}
