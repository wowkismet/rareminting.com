'use client';

import { useState } from 'react';

/**
 * The photograph field, with the size checked before anything is sent.
 *
 * A phone photograph of a banknote is routinely 2–5 MB. When one exceeded the
 * server's limit the upload was refused by nginx before the application ever
 * saw it, so nothing was logged and the seller was shown a blank error page
 * with no explanation. Checking here means the seller is told what is wrong
 * while they can still do something about it, and a request that would be
 * refused is never sent at all.
 *
 * The server limit is higher than this on purpose: this is the friendly stop,
 * not the real one.
 */
const MAX_BYTES = 10 * 1024 * 1024;

const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;

export function PhotoInput() {
  const [tooBig, setTooBig] = useState<number | null>(null);

  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
        Photograph<span className="ml-2 normal-case tracking-normal">optional</span>
      </span>

      <input
        type="file"
        name="photo"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file === undefined) {
            setTooBig(null);
            return;
          }
          if (file.size > MAX_BYTES) {
            setTooBig(file.size);
            // Clear it, so a form submitted anyway cannot carry the file that
            // would be refused further up.
            e.target.value = '';
            return;
          }
          setTooBig(null);
        }}
        className="text-sm text-slate file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:text-cream"
      />

      {tooBig !== null ? (
        <span role="alert" className="text-xs leading-relaxed text-ember">
          That photograph is {mb(tooBig)}, and the limit is {mb(MAX_BYTES)}. Most phones can send a
          smaller copy — choose “Medium” or “Large” rather than “Actual size” when sharing, or
          screenshot the photo and upload that. You can also list without a photograph now and add
          one from your dashboard later.
        </span>
      ) : (
        <span className="text-xs text-slate-dim">
          Buyers decide on the picture. Photograph it flat, in daylight, with the serial legible.
          Up to {mb(MAX_BYTES)}. You can add more from your dashboard afterwards.
        </span>
      )}
    </label>
  );
}
