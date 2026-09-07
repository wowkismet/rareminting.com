import type { Metadata } from 'next';

import { createBanner, deleteBanner, setBannerActive } from '@/app/actions.ts';
import { DashboardShell, Empty } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Promotions & banners',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface Banner {
  id: string;
  slot: string;
  headline: string;
  subtext: string | null;
  href: string | null;
  ctaLabel: string | null;
  imageUrl: string | null;
  altText: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

const SLOTS = [
  ['home_hero', 'Homepage — top', 'Across the top of the homepage, above everything.'],
  ['home_mid', 'Homepage — among the listings', 'Between rows of notes on the floor.'],
  ['browse', 'Browse — above the floor', 'On the page a buyer searches from.'],
  ['listing_page', 'A listing', 'On the page for a single note.'],
  ['cart', 'The basket', 'Seen by somebody about to pay.'],
] as const;

/** Whether a banner is actually being shown right now, and why not if not. */
function status(b: Banner): { label: string; tone: string } {
  if (!b.isActive) return { label: 'Off', tone: 'text-slate-dim' };
  const now = Date.now();
  if (b.startsAt !== null && new Date(b.startsAt).getTime() > now) {
    return { label: `From ${b.startsAt.slice(0, 10)}`, tone: 'text-accent-deep' };
  }
  if (b.endsAt !== null && new Date(b.endsAt).getTime() <= now) {
    return { label: `Ended ${b.endsAt.slice(0, 10)}`, tone: 'text-slate-dim' };
  }
  return {
    label: b.endsAt === null ? 'Live' : `Live until ${b.endsAt.slice(0, 10)}`,
    tone: 'text-accent-deep',
  };
}

/**
 * Banners, by where they appear.
 *
 * Grouped by slot rather than listed by date, because the question staff
 * actually have is "what is on the homepage right now", and a flat list sorted
 * by creation never answers it.
 */
export default async function AdminPromotionsPage() {
  const { user, token, sections } = await loadAdmin();
  const result = await api<{ banners: Banner[] }>('/v1/admin/banners', { token });
  const banners = result.ok ? result.data.banners : [];

  const live = banners.filter((b) => status(b).label.startsWith('Live')).length;

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Promotions & banners"
      subtitle={live === 0 ? 'Nothing showing' : `${live} showing now`}
      sections={sections}
      current="/admin/promotions"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Showing now" value={String(live)} accent />
          <StatCard label="Scheduled or off" value={String(banners.length - live)} />
          <StatCard label="Places to put one" value={String(SLOTS.length)} />
        </div>

        <Panel title="Put one up">
          <form
            action={createBanner}
            encType="multipart/form-data"
            className="grid gap-4 sm:grid-cols-2"
          >
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Where it goes
              </span>
              <select
                name="slot"
                defaultValue="home_hero"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              >
                {SLOTS.map(([value, label, hint]) => (
                  <option key={value} value={value}>
                    {label} — {hint}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Headline
              </span>
              <input
                name="headline"
                required
                maxLength={200}
                placeholder="A note that spells your date"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              />
            </label>

            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Line underneath
              </span>
              <input
                name="subtext"
                maxLength={300}
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Sends them to
              </span>
              <input
                name="href"
                placeholder="/browse?pattern=lucky"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 font-mono text-xs text-slate"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Button says
              </span>
              <input
                name="ctaLabel"
                maxLength={40}
                placeholder="Find yours"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Starts
              </span>
              <input
                name="startsAt"
                type="date"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Ends
              </span>
              <input
                name="endsAt"
                type="date"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Background image <span className="normal-case tracking-normal">optional</span>
              </span>
              <input
                type="file"
                name="file"
                accept="image/jpeg,image/png,image/webp"
                className="text-xs text-slate file:mr-2 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:text-cream"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                What the image shows
              </span>
              <input
                name="altText"
                maxLength={200}
                placeholder="Required if you attach one"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              />
            </label>

            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                Put it up
              </button>
            </div>
          </form>

          <p className="mt-4 text-xs leading-relaxed text-slate-dim">
            The headline is real text laid over the image rather than words baked into it — type in
            a picture cannot be read aloud, does not survive a slow connection and is invisible to
            a search engine. A link must be somewhere on this site. Leaving the end date empty means
            it runs until somebody turns it off, which is usually longer than intended.
          </p>
        </Panel>

        {SLOTS.map(([slot, label, hint]) => {
          const inSlot = banners.filter((b) => b.slot === slot);
          return (
            <Panel key={slot} title={label}>
              {inSlot.length === 0 ? (
                <Empty>{hint} Nothing here yet.</Empty>
              ) : (
                <ul className="flex flex-col gap-3">
                  {inSlot.map((b) => {
                    const s = status(b);
                    return (
                      <li
                        key={b.id}
                        className="flex flex-wrap items-start justify-between gap-4 rounded-sm border border-sand-line bg-sand-raised p-4"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          {b.imageUrl !== null ? (
                            <img
                              src={b.imageUrl}
                              alt=""
                              className="h-12 w-20 shrink-0 rounded-sm border border-sand-line object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded-sm border border-dashed border-sand-line text-[10px] text-slate-dim">
                              text only
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm text-slate">{b.headline}</p>
                            {b.subtext !== null && (
                              <p className="text-xs text-slate-dim">{b.subtext}</p>
                            )}
                            {b.href !== null && (
                              <p className="mt-0.5 font-mono text-[10px] text-slate-dim">
                                → {b.href}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`font-mono text-[10px] uppercase tracking-wider ${s.tone}`}>
                            {s.label}
                          </span>
                          <form action={setBannerActive}>
                            <input type="hidden" name="bannerId" value={b.id} />
                            <input
                              type="hidden"
                              name="isActive"
                              value={b.isActive ? 'no' : 'yes'}
                            />
                            <button
                              type="submit"
                              className="rounded-full border border-sand-line px-3 py-1 text-xs text-slate transition-colors hover:border-accent-deep"
                            >
                              {b.isActive ? 'Turn off' : 'Turn on'}
                            </button>
                          </form>
                          <form action={deleteBanner}>
                            <input type="hidden" name="bannerId" value={b.id} />
                            <button
                              type="submit"
                              className="rounded-full border border-sand-line px-3 py-1 text-xs text-slate-dim transition-colors hover:border-ember hover:text-ember"
                            >
                              Remove
                            </button>
                          </form>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          );
        })}
      </div>
    </DashboardShell>
  );
}
