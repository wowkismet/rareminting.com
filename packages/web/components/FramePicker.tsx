import { setFrame } from '@/app/actions.ts';
import { FrameTemplate } from '@/components/FrameTemplate.tsx';

export interface Frame {
  id: string;
  code: string;
  name: string;
  orientation: string;
  priceInr: number;
}

export interface FrameChoice {
  code: string | null;
  photoUrl: string | null;
  message: string | null;
  recipient: string | null;
  sender: string | null;
  occasionOn: string | null;
}

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

/**
 * Choosing a frame for one note.
 *
 * Closed by default. Framing is an addition rather than a decision every
 * buyer has to make, and a panel of eight frames open on every line would
 * bury the basket it sits in.
 *
 * Each frame is shown as itself rather than as a name in a list — these
 * differ by how they look, so a row of radio buttons reading "Royal Navy /
 * Heritage Blue" would be asking somebody to choose between two words. The
 * chips render the real template at chip size, with the note slot already
 * carrying this listing's photograph, so what is being chosen is visible.
 */
export function FramePicker({
  listingId,
  noteImageUrl,
  frames,
  chosen,
  open = false,
}: {
  listingId: string;
  noteImageUrl: string | null;
  frames: readonly Frame[];
  chosen: FrameChoice;
  /** Arrived here to frame this one, so it opens already. */
  open?: boolean;
}) {
  const current = frames.find((f) => f.code === chosen.code);

  return (
    <details
      id={`frame-${listingId}`}
      open={open || current !== undefined}
      className="frame-panel w-full scroll-mt-24 border-t border-sand-line pt-4"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
          Frame &amp; gift
        </span>
        <span className="text-sm text-accent-deep underline underline-offset-4">
          {current === undefined
            ? 'Frame this note & add a personal message'
            : `${current.name} · ${rupees(current.priceInr)}`}
        </span>
      </summary>

      <form action={setFrame} className="mt-4 flex flex-col gap-5">
        <input type="hidden" name="listingId" value={listingId} />

        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Choose a frame</legend>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
            {/* "No frame" is one of the options rather than a separate
                control, so choosing and un-choosing are the same gesture. */}
            <label className="flex cursor-pointer flex-col items-center gap-1.5">
              <input
                type="radio"
                name="frameCode"
                value=""
                defaultChecked={chosen.code === null}
                className="peer sr-only"
              />
              <span className="flex aspect-[7/10] w-full items-center justify-center rounded-sm border border-dashed border-sand-line text-center font-mono text-[9px] leading-tight text-slate-dim peer-checked:border-accent-deep peer-checked:text-slate">
                No
                <br />
                frame
              </span>
              <span className="text-center font-mono text-[9px] text-slate-dim">—</span>
            </label>

            {frames.map((f) => (
              <label key={f.code} className="flex cursor-pointer flex-col items-center gap-1.5">
                <input
                  type="radio"
                  name="frameCode"
                  value={f.code}
                  defaultChecked={chosen.code === f.code}
                  className="peer sr-only"
                />
                <span className="w-full rounded-sm ring-offset-2 ring-offset-sand-raised peer-checked:ring-2 peer-checked:ring-accent-deep">
                  <FrameTemplate
                    code={f.code}
                    content={{ noteImageUrl }}
                    className="w-full"
                  />
                </span>
                <span className="text-center text-[10px] leading-tight text-slate-dim">
                  {f.name}
                  <br />
                  <span className="tabular-nums text-slate">{rupees(f.priceInr)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
              Who it is for
            </span>
            <input
              name="recipient"
              maxLength={80}
              defaultValue={chosen.recipient ?? ''}
              placeholder="Amma"
              className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
              From
            </span>
            <input
              name="sender"
              maxLength={80}
              defaultValue={chosen.sender ?? ''}
              className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
            The message
          </span>
          <textarea
            name="message"
            rows={3}
            maxLength={400}
            defaultValue={chosen.message ?? ''}
            placeholder="What this date meant."
            className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm leading-relaxed text-slate"
          />
          <span className="text-xs text-slate-dim">
            Up to 400 characters — about what fits on the plate without shrinking.
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
              The date it marks
            </span>
            <input
              type="date"
              name="occasionOn"
              defaultValue={chosen.occasionOn ?? ''}
              className="rounded-sm border border-sand-line bg-sand px-3 py-2 font-mono text-sm text-slate"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
              A photograph {chosen.photoUrl !== null && '· one saved'}
            </span>
            <input
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/webp"
              className="text-xs text-slate-dim file:mr-3 file:rounded-full file:border file:border-sand-line file:bg-sand-raised file:px-3 file:py-1.5 file:text-xs file:text-slate"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            className="rounded-full bg-primary px-7 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
          >
            Save frame
          </button>
          <p className="text-xs leading-relaxed text-slate-dim">
            Your photograph is kept privately and is never shown on the site — only printed on
            the frame you are buying.
          </p>
        </div>
      </form>
    </details>
  );
}
