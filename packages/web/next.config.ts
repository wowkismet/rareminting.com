import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The serial engine ships raw TypeScript from `src/` with no build step, so
  // Next has to compile it rather than treat it as a prebuilt dependency.
  transpilePackages: ['@rareminting/serial-engine'],

  // Emit a self-contained server bundle. The VPS then runs one `node server.js`
  // with no `npm install` and no node_modules to ship.
  output: 'standalone',

  // In a workspace the tracer must start at the repo root, otherwise it misses
  // hoisted dependencies and the standalone build is silently incomplete.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
};

export default nextConfig;
