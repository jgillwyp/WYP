'use client'

import Link from 'next/link'

import './landing.css'
import { SUBSCRIBER_FEATURES } from './SubscriptionPanels'

// Live conversion of design/marketing/WYP_landing_page.html, 2026-08-13 —
// owner asked for this to become the actual unauthenticated `/` route
// rather than a static-only mockup (see app/page.tsx and the decisions
// log's 2026-08-13 entry). Content, copy, and the hand-built hero SVG are
// carried over verbatim from the mockup; see that file's own header
// comment for the full design reasoning (why a hand-built SVG instead of
// the owner's AI-placeholder photo, why mobile-first, where the copy came
// from). Only mechanical JSX conversions were made here: class ->
// className, kebab-case SVG presentation attributes -> camelCase, <a> ->
// next/link's <Link> for in-app destinations, and Inter is not re-loaded
// via a Google Fonts <link> (app/layout.tsx already self-hosts it via
// next/font as --font-inter, already in scope here).
//
// Header + hero-top redesigned 2026-08-13, owner-reported testing on a
// phone: the original single-row header (logo + wordmark + both CTA
// buttons) squeezed everything on a narrow viewport — the logo failed to
// render at all, and "Start Free Account" truncated mid-word. Owner's own
// fix, described directly and matched here: drop both buttons from the
// header entirely (logo + wordmark + tagline only, given more room since
// nothing else competes for it — "Tracking Requests and ToDos" reuses the
// exact tagline WypHeader.tsx already uses elsewhere in the app, for
// consistency) and move Start Free Account / Sign In into the hero itself,
// stacked in a column beside the three headline lines rather than below
// the lede — a layout that holds on a phone without the headline wrapping
// mid-word ("Send it.", "Track it.", "Get it Done." as three explicit
// lines, not one wrapped sentence). Start Free Account is light-blue
// (`.btn-tint`) here specifically so it reads as secondary to the larger
// white `.btn-white` "Start Free Account" repeated in the final CTA band
// further down the page — owner's own reasoning: "it looks better when on
// the same page as the larger white background version deeper in the
// text." Sign In is white (`.btn-white`, smaller) — a real button now,
// not the old plain-text link, so it can't read as a caption under Start
// Free Account. Both CTAs point to `/login`; Start Free Account adds
// `?intent=signup` so the sign-in screen can show "Sign In for Free
// Account" instead of a bare "Sign In" — see app/login/page.tsx.
// errorMessage (2026-08-18, optional, no default required per this app's
// own no-required-props convention) — surfaces an expired/invalid
// magic-link failure that app/page.tsx parses out of the URL hash on
// mount. Rendered as a .noticeband near the top of the hero, the same
// component other screens already use for banner-style messages (its
// neutral Strip background, not a new error-banner treatment — this app
// has no bright-red banner precedent anywhere, only inline .ferror text,
// which doesn't fit a whole-sentence message here).
export default function LandingPage({ errorMessage }: { errorMessage?: string | null }) {
  return (
    <div className="wyp-landing">
      <header className="topbar">
        <div className="wrap">
          <a className="brandmark" href="#top">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="16 8 212 200" width="42" height="40">
              <g>
                <path
                  d="M 52,22 H 156 A 24 24 0 0 1 180,46 V 138 A 24 24 0 0 1 156,162 H 86 L 44,198 L 52,162 A 24 24 0 0 1 28,138 V 46 A 24 24 0 0 1 52,22 Z"
                  fill="#FFFFFF"
                  stroke="#2A5FC8"
                  strokeWidth="11"
                  strokeLinejoin="round"
                />
                <rect x="52" y="46" width="104" height="11" rx="5.5" fill="#A7BCE8" />
                <rect x="52" y="70" width="104" height="11" rx="5.5" fill="#A7BCE8" />
                <rect x="52" y="94" width="76" height="11" rx="5.5" fill="#A7BCE8" />
                <rect x="52" y="118" width="58" height="11" rx="5.5" fill="#A7BCE8" />
                <polyline
                  points="104,122 140,158 210,52"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="40"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points="104,122 140,158 210,52"
                  fill="none"
                  stroke="#1A3A75"
                  strokeWidth="24"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </svg>
            <span className="brand">
              <span className="word">Would You Please</span>
              <span className="tag">Tracking Requests and ToDos</span>
            </span>
          </a>
        </div>
      </header>

      <main id="top">
        {errorMessage && (
          <div className="noticeband" role="alert">
            <b>Sign-in link problem:</b> {errorMessage}
          </div>
        )}
        {/* Hero */}
        <section className="hero">
          <div className="wrap">
            <div className="hero-copy">
              <div className="hero-top">
                <div className="hero-lines">
                  <div className="hero-line">Send it.</div>
                  <div className="hero-line">Track it.</div>
                  <div className="hero-line">Get it Done.</div>
                </div>
                <div className="hero-btns">
                  <Link className="btn-tint" href="/login?intent=signup">Start Free Account</Link>
                  <Link className="btn-white" href="/login">Sign In</Link>
                </div>
              </div>
              <div className="h2">The simple way to ask anyone for anything — and actually see it through.</div>
              <div className="lede">
                Asks sent by email or chat get buried, forgotten, and lost in long threads.
                With Would You Please, every ask is turned into a structured, trackable
                request with a due date, a formal response, and a clear status — Open,
                Overdue, or Done — visible to both of you. Your personal ToDos live right
                alongside, on one dashboard.
              </div>
              <div className="reassure">No credit card. Nothing to install — works right in your phone’s browser.</div>
            </div>

            {/* Hero illustration — hand-built SVG, not the AI placeholder photo;
                see design/marketing/WYP_landing_page.html's own header comment
                for why. A simplified, legible version of the app's own Main
                Screen, with floating callout badges echoing the owner's
                reference composition ("Send It" / "Track It" / "Get it Done"). */}
            <svg
              className="hero-art"
              viewBox="0 0 440 360"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label="A Would You Please dashboard showing tracked requests and their due dates"
            >
              <circle cx="392" cy="46" r="30" fill="#ffffff" opacity=".08" />
              <circle cx="34" cy="300" r="46" fill="#ffffff" opacity=".07" />

              {/* dashboard card */}
              <rect x="46" y="34" width="330" height="272" rx="16" fill="#ffffff" />
              <rect x="46" y="34" width="330" height="40" rx="16" fill="#F6F7F9" />
              <rect x="46" y="58" width="330" height="16" fill="#F6F7F9" />
              <circle cx="64" cy="54" r="5" fill="#D8DEE7" />
              <circle cx="80" cy="54" r="5" fill="#D8DEE7" />
              <circle cx="96" cy="54" r="5" fill="#D8DEE7" />
              <text x="330" y="59" textAnchor="end" fontFamily="Inter, sans-serif" fontSize="12" fontWeight="800" fill="#2A5FC8">
                Would You Please
              </text>

              {/* section pills: Sent / Received / ToDos */}
              <rect x="62" y="84" width="70" height="20" rx="10" fill="#2A5FC8" />
              <text x="97" y="98" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="700" fill="#ffffff">
                Sent
              </text>
              <rect x="138" y="84" width="86" height="20" rx="10" fill="#E5ECF7" />
              <text x="181" y="98" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="700" fill="#5A6675">
                Received
              </text>
              <rect x="230" y="84" width="70" height="20" rx="10" fill="#E5ECF7" />
              <text x="265" y="98" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="700" fill="#5A6675">
                ToDos
              </text>

              {/* rows */}
              <g fontFamily="Inter, sans-serif">
                {/* row 1: open */}
                <rect x="62" y="118" width="298" height="1" fill="#E2E6EC" />
                <text x="62" y="140" fontSize="12" fontWeight="700" fill="#1F2933">Prepare the June cash flow report</text>
                <text x="360" y="140" textAnchor="end" fontSize="11" fontWeight="800" fill="#1F2933">08-17-26</text>

                {/* row 2: overdue (red) */}
                <rect x="62" y="152" width="298" height="1" fill="#E2E6EC" />
                <text x="62" y="174" fontSize="12" fontWeight="700" fill="#D32F2F">Hire referees for Valley Little League</text>
                <text x="360" y="174" textAnchor="end" fontSize="11" fontWeight="800" fill="#D32F2F">07-22-26</text>

                {/* row 3: open */}
                <rect x="62" y="186" width="298" height="1" fill="#E2E6EC" />
                <text x="62" y="208" fontSize="12" fontWeight="700" fill="#1F2933">Confirm the office lease renewal terms</text>
                <text x="360" y="208" textAnchor="end" fontSize="11" fontWeight="800" fill="#1F2933">08-19-26</text>

                {/* row 4: done (muted) */}
                <rect x="62" y="220" width="298" height="1" fill="#E2E6EC" />
                <text x="62" y="242" fontSize="12" fontWeight="600" fill="#5A6675">Renew the annual insurance policy</text>
                <text x="360" y="242" textAnchor="end" fontSize="11" fontWeight="600" fill="#5A6675">08-02-26</text>
              </g>

              {/* search/filter strip */}
              <rect x="62" y="258" width="298" height="26" rx="8" fill="#F6F7F9" />
              <circle cx="76" cy="271" r="5" fill="none" stroke="#7E8A9A" strokeWidth="2" />
              <line x1="80" y1="275" x2="85" y2="280" stroke="#7E8A9A" strokeWidth="2" strokeLinecap="round" />
              <text x="96" y="275" fontFamily="Inter, sans-serif" fontSize="10.5" fontWeight="600" fill="#8A93A0">
                Search requests and ToDos…
              </text>

              {/* floating badge: Send It */}
              <g transform="translate(2,178)">
                <rect width="118" height="34" rx="17" fill="#123B7A" />
                <path d="M14 17 L26 11 L23 17 L26 23 Z" fill="#ffffff" />
                <text x="40" y="21" fontFamily="Inter, sans-serif" fontSize="12" fontWeight="800" fill="#ffffff">Send It</text>
              </g>

              {/* floating badge: Done, with check. Widened to 200px (was 128px)
                  and given a #123B7A border, 2026-08-13 — see the mockup's own
                  comment on this group for the full owner-reported reasoning. */}
              <g transform="translate(216,264)">
                <rect width="200" height="48" rx="12" fill="#ffffff" stroke="#123B7A" strokeWidth="2" />
                <circle cx="24" cy="24" r="13" fill="#2A5FC8" />
                <path d="M18 24 L22 28 L31 18" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                <text x="44" y="21" fontFamily="Inter, sans-serif" fontSize="11" fontWeight="800" fill="#1F2933">Get it Done!</text>
                <text x="44" y="35" fontFamily="Inter, sans-serif" fontSize="9.5" fontWeight="600" fill="#5A6675">Confirmed & closed out</text>
              </g>

              {/* floating badge: Track It. Given the same #123B7A border,
                  2026-08-13 — see the mockup's own comment on this group. */}
              <g transform="translate(302,4)">
                <rect width="120" height="32" rx="16" fill="#1C8FA0" stroke="#123B7A" strokeWidth="2" />
                <circle cx="18" cy="16" r="9" fill="none" stroke="#ffffff" strokeWidth="2" />
                <line x1="18" y1="16" x2="18" y2="11" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
                <line x1="18" y1="16" x2="22" y2="18" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
                <text x="34" y="20" fontFamily="Inter, sans-serif" fontSize="12" fontWeight="800" fill="#ffffff">Track It</text>
              </g>
            </svg>
          </div>
        </section>

        {/* Feature grid */}
        <section className="section">
          <div className="wrap">
            <div className="slabel">
              <span className="t">Everything you need to follow through</span>
              <span className="badge free">Free</span>
            </div>
            <div className="grid">
              <div className="card">
                <div className="ct">Trackable Requests</div>
                <div className="cb">Send a request to any contact with a due date. Status and overdue alerts keep it on the radar.</div>
              </div>
              <div className="card">
                <div className="ct">Formal Responses</div>
                <div className="cb">Recipients reply with answers. A timestamped Done confirmation closes the loop — no more “did you get to it?”</div>
              </div>
              <div className="card hi">
                <div className="ct">Add to Calendar</div>
                <div className="cb">Every request a recipient receives drops onto their calendar in one tap — the due date never gets lost.</div>
              </div>
              <div className="card">
                <div className="ct">ToDos with Priorities</div>
                <div className="cb">Track your own tasks as ASAP, SOON, or LATER, organized by category. Convert any ToDo into a request in one tap.</div>
              </div>
              <div className="card">
                <div className="ct">Dialog Threads</div>
                <div className="cb">Questions, answers, and comments stay attached to the item itself — a clear, auditable record, never lost in chat.</div>
              </div>
              <div className="card">
                <div className="ct">One Dashboard & Search</div>
                <div className="cb">Sent, Received, and My ToDos on one screen — filter, sort, print, and search. Find anything by person, category, or date.</div>
              </div>
            </div>
          </div>
        </section>

        {/* Who benefits — owner request, 2026-08-17. Placed directly before
            Subscription/Coming soon per his own instruction. Copy is his
            own, lightly tightened ("including for a wide range of" ->
            "across") to read more naturally — meaning and the deliberate
            "implied, not claimed" framing (categories of people the product
            could serve, not an assertion of who currently uses it) are
            unchanged; flagged for his review rather than silently kept as
            typed. */}
        <section className="section">
          <div className="wrap">
            <div className="slabel">
              <span className="t">Who benefits from Would You Please?</span>
            </div>
            <div className="benefits">
              Busy people who assign tasks — across business, professional, community, religious, government, and political organizations, as well as individuals.
            </div>
          </div>
        </section>

        {/* Subscription / Coming soon — subscription bullets (2026-08-27)
            now render from SubscriptionPanels.tsx's own SUBSCRIBER_FEATURES,
            the same canonical list Account Options and /account/subscription
            already use, so this panel can't drift out of sync with the real
            feature set/pricing again the way it had (still listing a flat
            $17.95/yr with no first-year-discount/renewal split, and still
            pitching Voice search under "Coming soon" after Voice dictation
            for Description/Dialog Text had already shipped as a live
            Subscriber feature). "Keep everything forever" is kept as its
            own bullet, appended after the shared list — it's this app's
            original free-vs-paid retention distinction (1-year vs perpetual
            history) and isn't part of SUBSCRIBER_FEATURES, which is scoped
            to newer capability additions only. */}
        <section className="section alt">
          <div className="wrap">
            <div className="cols">
              <div>
                <div className="slabel">
                  <span className="t">Coming with a subscription</span>
                  <span className="badge sub">$17.95 1st yr</span>
                </div>
                <div className="lpanel sub">
                  <ul>
                    {SUBSCRIBER_FEATURES.map((f) => (
                      <li key={f.title}><b>{f.title}</b> — {f.desc}</li>
                    ))}
                    <li><b>Keep everything forever</b> — perpetual history for your requests and files.</li>
                  </ul>
                  <div className="note">Just $1.50 a month for your first year — a fraction of team tools. Renews at $23.95/yr. The free plan keeps a full year of history.</div>
                </div>
              </div>
              <div>
                <div className="slabel">
                  <span className="t">Coming soon</span>
                  <span className="badge soon">Roadmap</span>
                </div>
                <div className="lpanel soon">
                  <ul>
                    <li><b>Voice search</b> — dictate a search instead of typing it.</li>
                    <li><b>Native apps</b> for iPhone, Android, and Windows, with push notifications.</li>
                  </ul>
                  <div className="note">Start on the web today — your account, requests, and ToDos carry over automatically when new features and apps arrive.</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA — owner request, 2026-08-17: dropped "Start free today at
            wouldyouplease.com" (this band is only ever seen already at
            wouldyouplease.com, so naming the site was redundant) and
            replaced it with the "No credit card..." line promoted to equal
            weight with "Send your first request...", both now bold — see
            the owner's own reference image and landing.css's .lead rule. */}
        <section className="section">
          <div className="wrap">
            <div className="ctaband">
              <div>
                <div className="lead">No credit card. No download. No setup.</div>
                <div className="lead">Send your first request in under a minute.</div>
              </div>
              <div className="price">
                <div className="amt">Free</div>
                <div className="per">Advanced features with a subscription — $17.95 first year, $23.95/yr after.</div>
              </div>
              <Link className="btn-white" href="/login?intent=signup">Start Free Account</Link>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <span>© 2026 Would You Please</span>
          <span>wouldyouplease.com</span>
        </div>
      </footer>
    </div>
  )
}
