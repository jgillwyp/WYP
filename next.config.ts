import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Force revalidation on sw.js/the manifest (2026-09-18, owner-reported
  // iPhone staleness — see PWAProvider.tsx's own version-check comment for
  // the full writeup). Without an explicit header, Vercel's default static-
  // asset caching for files under public/ leaves iOS Safari's own already-
  // aggressive PWA cache with no reason to ever re-check either file for
  // days. "no-cache" (not "no-store") is deliberate — it still allows the
  // response to be cached, but forces a conditional revalidation with the
  // server on every request, which is exactly what's needed to notice a
  // real change quickly without disabling caching outright.
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
    ]
  },
};

export default nextConfig;
