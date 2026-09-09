import { addAddress } from '@/app/actions.ts';

export interface Address {
  id: string;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  phone: string | null;
  isDefault: boolean;
}

/**
 * Where the parcel goes, chosen before anything is charged.
 *
 * The radio group sits inside the checkout form rather than in a step of its
 * own, so the buyer sees the address and the total together and does not have
 * to remember what they picked two pages ago. The "add a new one" form is a
 * details element underneath: open by necessity when the book is empty,
 * closed and out of the way once there is something to choose.
 *
 * Nothing here is a separate submit. Adding an address posts to its own
 * action and comes straight back to this page with the basket intact.
 */
export function AddressPicker({ addresses }: { addresses: readonly Address[] }) {
  const chosen = addresses.find((a) => a.isDefault) ?? addresses[0];

  return (
    <div className="flex flex-col gap-4 border-t border-sand-line pt-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
        Deliver to
      </p>

      {addresses.length === 0 ? (
        <p className="text-sm leading-relaxed text-slate-dim">
          We need an address before you pay — it is what the parcel is labelled with and what the
          bill is made out to. Add one below.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {addresses.map((a) => (
            <li key={a.id}>
              <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-sand-line bg-sand p-3 has-[:checked]:border-accent-deep">
                <input
                  type="radio"
                  name="addressId"
                  value={a.id}
                  defaultChecked={a.id === chosen?.id}
                  required
                  className="mt-1 accent-accent-deep"
                />
                <span className="text-sm leading-relaxed text-slate">
                  <span className="block font-medium">{a.recipientName}</span>
                  <span className="block text-slate-dim">
                    {a.line1}
                    {a.line2 !== null && a.line2 !== '' && `, ${a.line2}`}
                    <br />
                    {a.city}, {a.state} {a.postalCode}
                    {a.phone !== null && (
                      <>
                        <br />
                        {a.phone}
                      </>
                    )}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}

/**
 * The add-an-address form.
 *
 * Deliberately a sibling of the checkout form, never a child of it: a form
 * nested inside another is invalid HTML, and browsers deal with it by
 * discarding the inner one — so the address would silently never be saved.
 */
export function AddressForm({ back }: { back: string }) {
  return (
    <form
      action={addAddress}
      className="flex flex-col gap-3 rounded-sm border border-sand-line bg-sand-raised p-5"
    >
      <input type="hidden" name="back" value={back} />
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
        Add a delivery address
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="recipientName" label="Full name" required autoComplete="name" />
        <Field name="phone" label="Mobile number" autoComplete="tel" placeholder="98765 43210" />
        <div className="sm:col-span-2">
          <Field
            name="line1"
            label="Flat, building, street"
            required
            autoComplete="address-line1"
          />
        </div>
        <div className="sm:col-span-2">
          <Field name="line2" label="Area, landmark (optional)" autoComplete="address-line2" />
        </div>
        <Field name="city" label="City" required autoComplete="address-level2" />
        <Field name="state" label="State" required autoComplete="address-level1" />
        <Field
          name="postalCode"
          label="PIN code"
          required
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="400064"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-dim">
        <input type="checkbox" name="isDefault" value="yes" className="accent-accent-deep" />
        Make this my default address
      </label>

      <button
        type="submit"
        className="self-start rounded-full border border-accent-deep px-6 py-2 text-sm text-accent-deep transition-colors hover:bg-accent-deep hover:text-cream"
      >
        Save address
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  required = false,
  ...rest
}: {
  name: string;
  label: string;
  required?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
        {label}
      </span>
      <input
        name={name}
        required={required}
        maxLength={200}
        className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate outline-none focus-visible:border-accent-deep"
        {...rest}
      />
    </label>
  );
}
