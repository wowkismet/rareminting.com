import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { signUp } from '@/app/actions.ts';
import { ActionForm, Field } from '@/components/Forms.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { currentUser } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Create an account' };
export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  const user = await currentUser();
  if (user !== null) redirect('/account');

  return (
    <div>
      <SiteHeader user={null} compact />
      <main className="mx-auto flex max-w-md flex-col gap-7 px-5 py-14">
        <div>
          <h1 className="font-display text-3xl text-slate">Create an account</h1>
          <p className="mt-2 text-sm text-slate-dim">
            One account to buy, to save the dates that matter to you, and to sell.
          </p>
        </div>

        <ActionForm action={signUp} submitLabel="Create account">
          <Field label="Your name" name="fullName" autoComplete="name" placeholder="Asha Raman" />
          <Field
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            hint="At least 10 characters. Length matters more than symbols."
          />
        </ActionForm>

        <p className="text-sm text-slate-dim">
          Already have an account?{' '}
          <a className="text-accent-deep underline underline-offset-4" href="/signin">
            Sign in
          </a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
