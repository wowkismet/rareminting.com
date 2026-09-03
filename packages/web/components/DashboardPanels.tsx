/**
 * The pieces the seller dashboard is built from.
 *
 * The charts are inline SVG computed on the server. No charting library, no
 * client JavaScript: the numbers are known when the page is rendered, and
 * shipping a runtime to redraw what is already fixed would cost every seller a
 * download for nothing.
 */

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

/** A headline figure, on the dark ground the mock uses for the top row. */
export function StatCard({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  accent?: boolean;
}) {
  return (
    <div className="guilloche flex flex-col justify-between rounded-sm border border-line bg-primary p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-dim">{label}</p>
      <p
        className={`mt-3 font-display text-2xl tabular-nums sm:text-3xl ${
          accent ? 'text-accent-bright' : 'text-cream'
        }`}
      >
        {value}
      </p>
      {hint !== undefined && <p className="mt-2 text-xs text-cream-dim">{hint}</p>}
    </div>
  );
}

/** A titled panel. */
export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: { href: string; label: string } | undefined;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-sm border border-sand-line bg-sand-raised p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-lg text-slate">{title}</h2>
        {action !== undefined && (
          <a
            href={action.href}
            className="text-xs text-accent-deep underline underline-offset-4"
          >
            {action.label}
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Daily takings as an area chart.
 *
 * The y-axis always starts at zero. Starting it at the minimum would make a
 * flat month look dramatic, which is the commonest way a sales chart lies to
 * the person reading it.
 */
export function SalesChart({ series }: { series: readonly { day: string; inr: number }[] }) {
  const width = 720;
  const height = 200;
  const pad = { top: 12, right: 8, bottom: 22, left: 8 };

  const values = series.map((p) => p.inr);
  const peak = Math.max(...values, 1);
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const x = (i: number): number =>
    pad.left + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number): number => pad.top + innerH - (v / peak) * innerH;

  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.inr).toFixed(1)}`).join('');
  const area = `${line}L${x(series.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)}L${x(0).toFixed(1)},${(pad.top + innerH).toFixed(1)}Z`;

  const total = values.reduce((sum, v) => sum + v, 0);
  const first = series[0]?.day ?? '';
  const last = series[series.length - 1]?.day ?? '';

  return (
    <div>
      <p className="font-display text-3xl tabular-nums text-slate">{rupees(total)}</p>
      <p className="mt-1 text-xs text-slate-dim">Last 30 days</p>

      {total === 0 ? (
        <p className="mt-6 rounded-sm border border-dashed border-sand-line px-4 py-8 text-center text-sm text-slate-dim">
          Nothing sold in the last 30 days. The line starts the day your first order does.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Daily sales for the last 30 days, ${rupees(total)} in total`}
          className="mt-4 w-full"
        >
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#salesFill)" />
          <path
            d={line}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {series.map((p, i) =>
            p.inr > 0 ? (
              <circle
                key={p.day}
                cx={x(i)}
                cy={y(p.inr)}
                r="3"
                fill="var(--color-accent-deep)"
              />
            ) : null,
          )}
          <text x={pad.left} y={height - 6} className="fill-slate-dim" fontSize="11">
            {first.slice(5)}
          </text>
          <text x={width - pad.right} y={height - 6} textAnchor="end" className="fill-slate-dim" fontSize="11">
            {last.slice(5)}
          </text>
        </svg>
      )}
    </div>
  );
}

/**
 * A donut of what sells, by kind.
 *
 * Drawn with stroke-dasharray on a circle rather than arc paths — fewer moving
 * parts, and a segment cannot end up malformed by a rounding error in an arc
 * flag.
 */
export function CategoryDonut({
  slices,
}: {
  slices: readonly { label: string; value: number; colour: string }[];
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = 60;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const drawn = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const fraction = s.value / total;
      const seg = {
        ...s,
        dash: fraction * circumference,
        gap: circumference - fraction * circumference,
        offset: -offset * circumference,
        percent: fraction * 100,
      };
      offset += fraction;
      return seg;
    });

  if (total === 0) {
    return (
      <p className="rounded-sm border border-dashed border-sand-line px-4 py-8 text-center text-sm text-slate-dim">
        Nothing listed yet, so there is nothing to break down.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 160 160" className="h-40 w-40 shrink-0 -rotate-90" role="img" aria-label="Listings by kind">
        {drawn.map((s) => (
          <circle
            key={s.label}
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={s.colour}
            strokeWidth="20"
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeDashoffset={s.offset}
          />
        ))}
      </svg>

      <dl className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        {drawn.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: s.colour }}
            />
            <dt className="flex-1 text-slate-dim">{s.label}</dt>
            <dd className="tabular-nums text-slate">
              {s.value} <span className="text-slate-dim">({s.percent.toFixed(0)}%)</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A row of shortcuts, as in the mock. */
export function QuickActions({
  actions,
}: {
  actions: readonly { href: string; label: string; icon: string }[];
}) {
  return (
    <section className="rounded-sm border border-sand-line bg-sand-raised p-5">
      <h2 className="mb-4 font-display text-lg text-slate">Quick actions</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {actions.map((a) => (
          <a
            key={a.href}
            href={a.href}
            className="flex flex-col items-center gap-2 rounded-sm border border-sand-line bg-sand px-3 py-4 text-center text-xs text-slate transition-colors hover:border-accent-deep"
          >
            <span aria-hidden className="text-xl">
              {a.icon}
            </span>
            {a.label}
          </a>
        ))}
      </div>
    </section>
  );
}
