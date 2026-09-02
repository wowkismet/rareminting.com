/**
 * Photographs of a note.
 *
 * Plain `<img>` rather than `next/image`: these are seller uploads served by
 * Nginx from disk, and routing them through the optimiser would put every
 * visitor's image request back through Node for no gain.
 *
 * Obverse and reverse are labelled, because for a banknote which side you are
 * looking at is information, not decoration.
 */

const KIND_LABEL: Record<string, string> = {
  obverse: 'Front',
  reverse: 'Back',
  detail: 'Detail',
  uv: 'Under UV',
};

export interface NoteMedia {
  id: string;
  kind: string;
  url: string;
}

export function NotePhotos({ media, title }: { media: readonly NoteMedia[]; title: string }) {
  if (media.length === 0) return null;

  const first = media[0];
  if (first === undefined) return null;
  const rest = media.slice(1);

  return (
    <section aria-label="Photographs" className="flex flex-col gap-3">
      <figure className="flex flex-col gap-2">
        <img
          src={first.url}
          alt={`${title} — ${KIND_LABEL[first.kind] ?? first.kind}`}
          className="w-full rounded-sm border border-sand-line bg-sand-raised object-contain"
        />
        <figcaption className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
          {KIND_LABEL[first.kind] ?? first.kind}
        </figcaption>
      </figure>

      {rest.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {rest.map((m) => (
            <li key={m.id}>
              <img
                src={m.url}
                alt={`${title} — ${KIND_LABEL[m.kind] ?? m.kind}`}
                loading="lazy"
                className="aspect-[3/2] w-full rounded-sm border border-sand-line object-cover"
              />
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
                {KIND_LABEL[m.kind] ?? m.kind}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Upload control, shown only to the seller who owns the listing.
 *
 * A plain multipart form post — no client JavaScript, so it works before the
 * page has hydrated and on a phone with a flaky connection.
 */
export function PhotoUpload({
  listingId,
  action,
}: {
  listingId: string;
  action: (data: FormData) => Promise<void>;
}) {
  return (
    <form
      action={action}
      encType="multipart/form-data"
      className="flex flex-col gap-4 rounded-sm border border-sand-line bg-sand-raised p-5"
    >
      <input type="hidden" name="listingId" value={listingId} />

      <div>
        <h2 className="font-display text-xl text-slate">Add a photograph</h2>
        <p className="mt-1 text-sm text-slate-dim">
          Photograph the note flat, in daylight, with the serial number legible. Buyers decide on
          the picture — a clear front and back sells a note faster than any description.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
            Which side
          </span>
          <select
            name="kind"
            defaultValue="obverse"
            className="rounded-sm border border-sand-line bg-sand px-4 py-2.5 text-slate outline-none focus-visible:border-accent-deep"
          >
            <option value="obverse">Front</option>
            <option value="reverse">Back</option>
            <option value="detail">Detail</option>
            <option value="uv">Under UV</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
            Image
          </span>
          <input
            type="file"
            name="file"
            required
            accept="image/jpeg,image/png,image/webp"
            className="text-sm text-slate file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:text-cream"
          />
        </label>

        <button
          type="submit"
          className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
        >
          Upload
        </button>
      </div>

      <p className="text-xs text-slate-dim">
        JPEG, PNG or WebP, up to 10 MB. We check the file really is an image before storing it.
      </p>
    </form>
  );
}
