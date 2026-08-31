import type { DateInterpretation } from '@rareminting/serial-engine';
import { formatInr, type CatalogueEntry } from '@/lib/catalogue.ts';
import { SerialPlate } from './SerialPlate.tsx';

const ERA_LABEL: Record<string, string> = {
  heritage: 'Heritage',
  historic: 'Historic',
  modern: 'Modern',
  recent: 'Recent',
  future: 'Future',
};

/** A listing, laid out like a museum catalogue entry rather than a product tile. */
export function NoteCard({
  entry,
  interpretation,
  badge,
}: {
  entry: CatalogueEntry;
  interpretation?: DateInterpretation | undefined;
  badge?: string | undefined;
}) {
  const { analysis } = entry;
  const shown = interpretation ?? analysis.bestDate ?? undefined;
  const tags = analysis.patterns.slice(0, 3);

  return (
    <article className="group flex flex-col gap-4 border border-sand-line bg-sand-raised p-5 transition-colors hover:border-accent-deep/60">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-slate-dim">
            Lot {entry.id}
          </p>
          <h3 className="mt-1 text-xl">
            ₹{entry.denomination}
            <span className="ml-2 text-sm text-slate-dim">{entry.series}</span>
          </h3>
        </div>
        {badge !== undefined && (
          <span className="shrink-0 border border-accent-deep/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-accent-deep">
            {badge}
          </span>
        )}
      </header>

      <SerialPlate
        prefix={analysis.serial.prefix}
        digits={analysis.serial.serialDigits}
        isStar={analysis.serial.isStar}
        interpretation={shown}
      />

      {shown !== undefined && (
        <p className="text-sm text-slate">
          Reads as{' '}
          <span className="font-mono text-accent-deep">
            {shown.isPartial ? shown.iso.replace('--', '') : shown.iso}
          </span>
          {shown.era !== null && (
            <span className="text-slate-dim"> · {ERA_LABEL[shown.era] ?? shown.era}</span>
          )}
          <span className="text-slate-dim">
            {' '}
            · {(shown.confidence * 100).toFixed(0)}% confidence
          </span>
        </p>
      )}

      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li
              key={`${tag.code}-${tag.detail ?? ''}`}
              className="border border-sand-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim"
              title={tag.detail ?? undefined}
            >
              {tag.label}
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-auto flex items-end justify-between gap-4 pt-2 rule-sand">
        <div>
          <p className="font-display text-2xl text-slate">{formatInr(entry.priceInr)}</p>
          <p className="text-xs text-slate-dim">
            {entry.grade} · {entry.seller}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-deep">
          Minted
        </span>
      </footer>
    </article>
  );
}
