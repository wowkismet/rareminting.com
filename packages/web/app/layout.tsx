import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono, Playfair_Display } from 'next/font/google';
import './globals.css';

// Self-hosted at build time by next/font — no runtime CDN request, no FOUT
// from a third party, and nothing to break if Google is blocked.
const display = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
  // The wordmark is set in the bold italic cut, so both axes are needed.
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
});

const body = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

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
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
