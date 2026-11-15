'use client'

import { useRouter } from 'next/navigation'
import Image from 'next/image'

import WypHeader from '../components/WypHeader'
import './ad-landing.css'

// Ad landing page — new route, 2026-11-15. The real destination for the
// sample ad AppFooter.tsx now shows to every Free account (see that file's
// own comment for the full history) — Jim: "The app should accurately
// represent the intended size in live use - for the ads... We should
// create a dummy landing page for an ad... and link the ad to that page."
//
// No RequireAuth — same posture as /privacy and /login: a link meant to
// stand in for a real ad's own destination has to open for anyone who
// clicks it, signed in or not, the same way a real external advertiser's
// site would. Content is deliberately fictional ("Sunset River Outfitters"
// is placeholder sample copy, not a real business) and says so plainly —
// this exists to prove the ad slot's size, image, link, and destination
// page all work end to end, not to pitch anything real. No click or
// impression tracking is wired up anywhere yet, and there is no real ad
// network behind this — both flagged as open, not silently assumed done.
//
// Hero image and the footer ad's own icon are both photos Jim supplied
// (public/ads/ad-landing-hero.jpg, public/ads/sample-ad-icon.png — resized
// and re-encoded from his originals with sharp to keep the page light).
// Reuses the standard .frame-none/.app/.scroll/.band shell every other app
// screen already uses (480px, mobile-first) — this page is reached from
// inside that frame, unlike /privacy's own wider reading-width layout.

export default function AdLandingPage() {
  const router = useRouter()

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">Ad Landing Page</span>
          <span className="bandcluster">
            <button className="btn-secondary" type="button" onClick={() => router.back()}>
              Close
            </button>
          </span>
        </div>

        <div className="noticeband">
          <b>Note:</b> This is a sample destination page for testing the ad slot shown to Free
          accounts below — not a real advertiser.
        </div>

        <div className="scroll">
          <div className="ad-landing">
            <Image
              src="/ads/ad-landing-hero.jpg"
              alt="A river running through a pine forest, with granite boulders along its banks"
              width={1200}
              height={675}
              priority
              className="ad-landing-hero"
            />

            <h1 className="ad-landing-title">Sunset River Outfitters</h1>
            <p className="ad-landing-tagline">Guided day trips. Gear rentals. Every trail, every river.</p>

            <p className="ad-landing-body">
              This placeholder page stands in for wherever a real advertiser&rsquo;s own site would
              open. It exists to confirm the ad slot&rsquo;s size, image, link, and destination page
              all work end to end &mdash; before a real ad network is ever connected.
            </p>

            <button className="btn" type="button" disabled aria-disabled="true">
              Learn More
            </button>
            <p className="ad-landing-fineprint">
              This button is inert &mdash; there is nothing further to link to yet.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
