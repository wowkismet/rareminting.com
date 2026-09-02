'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { NO_ERROR, type FormState } from '@/lib/form-state.ts';

/**
 * Shared form pieces.
 *
 * The only client components in the app. Everything else renders on the server;
 * these exist so a form can show a pending state and an error without a full
 * page reload.
 */

export function Field({
  label,
  name,
  type = 'text',
  required = false,
  placeholder,
  hint,
  defaultValue,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  defaultValue?: string;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
        {label}
        {!required && <span className="ml-2 normal-case tracking-normal">optional</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        className="rounded-sm border border-sand-line bg-sand-raised px-4 py-2.5 text-slate outline-none transition-colors placeholder:text-slate-dim/60 focus-visible:border-accent-deep focus-visible:ring-1 focus-visible:ring-accent-deep"
      />
      {hint !== undefined && <span className="text-xs text-slate-dim">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="rounded-sm border border-sand-line bg-sand-raised px-4 py-2.5 text-slate outline-none focus-visible:border-accent-deep focus-visible:ring-1 focus-visible:ring-accent-deep"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Submit({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-primary px-8 py-3 text-sm font-medium text-cream transition-colors hover:bg-secondary focus-visible:bg-secondary disabled:opacity-60"
    >
      {pending ? 'Working…' : children}
    </button>
  );
}

export function ActionForm({
  action,
  submitLabel,
  children,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, NO_ERROR);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {children}
      {state.error !== null && (
        <p
          role="alert"
          className="rounded-sm border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-slate"
        >
          {state.error}
        </p>
      )}
      {state.notice != null && state.notice !== '' && (
        <p
          role="status"
          className="rounded-sm border border-accent-deep/50 bg-accent-deep/10 px-4 py-3 text-sm text-slate"
        >
          {state.notice}
        </p>
      )}
      <div>
        <Submit>{submitLabel}</Submit>
      </div>
    </form>
  );
}
