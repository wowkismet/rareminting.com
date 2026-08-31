import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const SITE_URL = 'https://www.rareminting.com';
const DESCRIPTION =
  'An independent heritage marketplace for banknotes, coins and collectibles whose serial numbers match the dates that matter.';

export const metadata: Metadata = {
  // Absolute base for canonical and social URLs. Required before the
  // per-date SEO landing pages (/notes/date/15-08-1947) can resolve properly.
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Rare Minting — Where numbers become heirlooms',
    template: '%s · Rare Minting',
  },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Rare Minting',
    title: 'Rare Minting — Where numbers become heirlooms',
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
