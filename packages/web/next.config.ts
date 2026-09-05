import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The serial engine ships raw TypeScript from `src/` with no build step, so
  // Next has to compile it rather than treat it as a prebuilt dependency.
  transpilePackages: ['@rareminting/serial-engine', '@rareminting/config'],

  // Emit a self-contained server bundle. The VPS then runs one `node server.js`
  // with no `npm install` and no node_modules to ship.
  output: 'standalone',

  // In a workspace the tracer must start at the repo root, otherwise it misses
  // hoisted dependencies and the standalone build is silently incomplete.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),

  experimental: {
    serverActions: {
      // A listing is submitted as a server action carrying a photograph, and
      // a phone photo of a banknote is routinely 2-5 MB. Next caps a server
      // action body at 1 MB by default and rejects the rest with a 413.
      //
      // This is the *second* 1 MB limit on that upload: nginx has one too, set
      // in deploy/provision.sh. Raising only one leaves the other in place and
      // the seller sees the same failure, so the two are deliberately kept at
      // the same figure — change one, change the other.
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
