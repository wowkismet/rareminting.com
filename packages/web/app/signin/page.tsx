import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { signIn } from '@/app/actions.ts';
import { ActionForm, Field } from '@/components/Forms.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { currentUser } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  const user = await currentUser();
  if (user !== null) redirect('/account');

  return (
    <div>
      <SiteHeader user={null} compact />
      <main className="mx-auto flex max-w-md flex-col gap-7 px-5 py-14">
        <h1 className="font-display text-3xl text-slate">Sign in</h1>

        <ActionForm action={signIn} submitLabel="Sign in">
          <Field label="Email" name="email" type="email" required autoComplete="email" />
          <Field
            label="Password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </ActionForm>

        <p className="text-sm text-slate-dim">
          No account yet?{' '}
          <a className="text-accent-deep underline underline-offset-4" href="/signup">
            Create one
          </a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
