import type { DateInterpretation } from '@rareminting/serial-engine';
import { kindAt, segmentsFor } from '@/lib/segments.ts';

const KIND_COLOR: Record<string, string> = {
  day: 'text-brass-bright',
  month: 'text-parchment',
  year: 'text-brass-bright',
};

/**
 * The serial rendered as the hero element of a listing — engraved, tabular, and
 * annotated with the day/month/year split when a date reading is supplied.
 */
export function SerialPlate({
  prefix,
  digits,
  isStar,
  interpretation,
  size = 'md',
}: {
  prefix: string | null;
  digits: string;
  isStar: boolean;
  interpretation?: DateInterpretation | undefined;
  size?: 'md' | 'lg';
}) {
  const segments = segmentsFor(interpretation?.patterns[0]);
  const scale = size === 'lg' ? 'text-4xl sm:text-5xl' : 'text-2xl';

  return (
    <div className="guilloche rounded-sm border border-vault-line bg-vault-raised/70 px-4 py-3">
      <div className="flex items-baseline gap-3 font-mono">
        {prefix !== null && (
          <span className="text-parchment-dim text-sm tracking-[0.2em]">
            {prefix}
            {isStar && <span className="text-vermilion">*</span>}
          </span>
        )}
        <span className={`${scale} engraved tracking-[0.14em] tabular-nums`}>
          {digits.split('').map((digit, index) => {
            const kind = kindAt(index, segments);
            const colour = kind === null ? 'text-parchment' : KIND_COLOR[kind] ?? 'text-parchment';
            return (
              <span
                key={index}
                className={`${colour} ${kind !== null ? 'settle-in' : ''}`}
                style={kind !== null ? { animationDelay: `${index * 45}ms` } : undefined}
              >
                {digit}
              </span>
            );
          })}
        </span>
      </div>

      {segments.length > 0 && (
        <div className="mt-1 flex gap-3 font-mono text-[10px] uppercase tracking-[0.25em] text-parchment-dim">
          {segments.map((segment) => (
            <span key={segment.kind}>{segment.kind}</span>
          ))}
        </div>
      )}
    </div>
  );
}
