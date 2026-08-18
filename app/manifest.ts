import type { MetadataRoute } from 'next'

// Web App Manifest (Next.js's native app/manifest.ts route convention —
// auto-generates /manifest.webmanifest and its own <link rel="manifest">
// tag, no manual <head> edit needed) — 2026-08-18, replacing Android
// Chrome's own ad hoc install guess (a page-title-only shortcut with no
// icon) with a real, deliberate one. See CLAUDE.md's Known gaps for the
// full write-up: this was prompted by a live bug report (Chrome's "open
// external app" dialog for an install neither the owner nor this codebase
// had knowingly created) and is being shipped anyway, on purpose, because
// end users are about to start using this app and a correct icon/name is a
// better first impression than Chrome's own guess.
//
// icons/icon-192.png and icons/icon-512.png (app/../public/icons/) are
// rasterized from icons/icon-source.svg, itself a recolored, padded
// (roughly 66%-of-canvas safe zone, matching maskable-icon guidance)
// version of the existing "checked request" brandmark already used in
// LandingPage.tsx's header — same shape, same brand blue (#2A5FC8),
// recentered on a full-bleed rounded-square background so it reads
// cleanly as a standalone icon rather than a mark meant to sit on white.
// Not extracted to a shared component — it's a static asset pipeline
// (SVG -> PNG via ImageMagick at build time, not runtime), unlike the
// inline JSX SVGs used elsewhere in this app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Would You Please',
    short_name: 'Would You Please',
    description: 'Tracking Requests and ToDos',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2A5FC8',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
