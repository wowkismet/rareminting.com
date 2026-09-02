/**
 * Shared shape for form results.
 *
 * Kept out of `app/actions.ts` because a `'use server'` module may only export
 * async functions — a plain constant there fails the build.
 */
export interface FormState {
  readonly error: string | null;
  readonly field?: string | null;
  /** A confirmation rather than a failure, e.g. "code sent". */
  readonly notice?: string | null;
}

export const NO_ERROR: FormState = { error: null };
