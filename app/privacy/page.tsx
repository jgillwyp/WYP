import Link from 'next/link'
import './privacy.css'

// Privacy Policy — new route, 2026-09-01. Jim asked for a data privacy
// statement he could give to end users; offered a choice of a reviewable
// document vs. a live page, and he picked live. Built directly as plain
// prose content, not a Palette-1 "screen" — no design/screens mockup
// exists for this and none of the app's form/button component classes
// apply to a legal document, so the mockup-first rule doesn't fit here;
// see the decisions log's 2026-09-01 entry for the full reasoning. No
// RequireAuth — like the landing page and /login, this must be reachable
// by a signed-out visitor. Linked from the landing page's footer only for
// now; not yet linked from /login or the authenticated app's own Account
// screen, flagged as a lightweight follow-up if Jim wants it there too.
//
// Content reflects this app's actual current practices as built, not
// generic boilerplate — see each section for specifics (Supabase, Vercel,
// Hostinger, the Office Online viewer, the browser's own Voice Dictation
// engine). Two things are explicitly NOT overstated: no real payment
// processor is live yet (Subscribed? is a testing-only toggle today), and
// the free-tier one-year retention model described in the PRD is not yet
// enforced by an automated deletion job — both are worded as current
// state, not aspirational claims. This is informational content, not
// legal advice — Jim (or a lawyer he engages) should review before
// treating this as a substitute for professional legal review, especially
// if WYP's user base later includes residents of jurisdictions with their
// own specific disclosure requirements (e.g. GDPR, CCPA).
export default function PrivacyPolicyPage() {
  return (
    <div className="wyp-privacy">
      <header className="ptop">
        <div className="wrap">
          <Link className="brandmark" href="/">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="16 8 212 200"><g><path d="M 52,22 H 156 A 24 24 0 0 1 180,46 V 138 A 24 24 0 0 1 156,162 H 86 L 44,198 L 52,162 A 24 24 0 0 1 28,138 V 46 A 24 24 0 0 1 52,22 Z" fill="#FFFFFF" stroke="#2A5FC8" strokeWidth="11" strokeLinejoin="round"/><rect x="52" y="46" width="104" height="11" rx="5.5" fill="#A7BCE8"/><rect x="52" y="70" width="104" height="11" rx="5.5" fill="#A7BCE8"/><rect x="52" y="94" width="76" height="11" rx="5.5" fill="#A7BCE8"/><rect x="52" y="118" width="58" height="11" rx="5.5" fill="#A7BCE8"/><polyline points="104,122 140,158 210,52" fill="none" stroke="#FFFFFF" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round"/><polyline points="104,122 140,158 210,52" fill="none" stroke="#1A3A75" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round"/></g></svg>
            <span className="word">Would You Please</span>
          </Link>
          <Link className="back" href="/">&larr; Back to wouldyouplease.com</Link>
        </div>
      </header>

      <main className="wrap">
        <h1>Privacy Policy</h1>
        <div className="eff">Effective September 1, 2026</div>
        <p className="intro">
          Would You Please (&ldquo;WYP,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) helps people track
          Requests they send to others and personal ToDos, with a formal response and a due date
          for each. This page explains what information we collect, how we use it, who we share
          it with, and the choices you have.
        </p>

        <h2>Information we collect</h2>
        <p>When you create a Would You Please account, we collect:</p>
        <ul>
          <li><b>Your email address</b> — used to sign you in. We use passwordless &ldquo;magic
            link&rdquo; sign-in; we never ask for or store a password.</li>
          <li><b>Your display name and time zone</b> — shown to people you send Requests to, and
            used to schedule Reminder emails at the right local time.</li>
          <li><b>Contacts you add</b> — the name, email address, phone number, and any notes you
            enter for people you plan to send Requests to.</li>
          <li><b>Requests, ToDos, and Dialog entries</b> — the descriptions, due dates,
            categories, priorities, and Question/Answer/Comment threads you and your Request
            recipients create.</li>
          <li><b>Attachments</b> — files you or a recipient upload to a Request, Response, or
            ToDo (subject to a storage limit that depends on your account tier).</li>
          <li><b>Your notification and display preferences</b> — settings like which Reminder
            emails you want, whether Due/Done times are shown, and similar in-app choices.</li>
        </ul>
        <p>
          If someone sends you a Request by email, you can respond through a secure, one-time
          link <b>without creating an account</b>. In that case we only handle the Request
          information the sender already entered (including your name, email, or phone number as
          a Contact they added) and whatever response, Dialog entry, or attachment you choose to
          submit through that link.
        </p>

        <h2>How we use your information</h2>
        <ul>
          <li>To operate the core product — creating, tracking, and displaying your Requests,
            ToDos, Dialog threads, and Attachments, and enforcing that each account can only see
            its own data.</li>
          <li>To send you transactional email: sign-in links, a notification when someone sends
            you a Request, and the Reminder emails you&rsquo;ve chosen (day-before, day-of, and/or
            day-after a due date).</li>
          <li>To run scheduled background checks (roughly hourly) that look for Requests and
            ToDos coming due or overdue, so the Reminder emails above can go out automatically.</li>
          <li>To maintain the security of the service — for example, restricting access to
            attachments and Dialog entries to the people who are actually part of that Request.</li>
        </ul>
        <p>
          We do not sell your personal information, and we do not use your Requests, ToDos, or
          Dialog content to train any third-party AI model.
        </p>

        <h2>Who we share information with</h2>
        <p>
          We use a small number of service providers to operate Would You Please. Each only
          receives the information it needs to do its job:
        </p>
        <ul>
          <li><b>Supabase</b> — our database, authentication, and private file storage provider.
            Nearly all of the information described above is stored here.</li>
          <li><b>Vercel</b> — hosts the application and runs our scheduled Reminder-checking
            jobs.</li>
          <li><b>Hostinger</b> — delivers our outbound email (sign-in links, notifications, and
            Reminders) on our behalf.</li>
          <li><b>Microsoft Office Online Viewer</b> — used only if you choose to open a Word,
            Excel, or PowerPoint attachment; a temporary, expiring link to that specific file is
            sent to Microsoft&rsquo;s servers so it can be previewed in your browser.</li>
          <li><b>Your browser&rsquo;s built-in speech recognition</b> — if you use the optional
            Voice Dictation feature, your browser (not Would You Please) processes the audio using
            its own speech-to-text service; we only ever receive the resulting text.</li>
        </ul>
        <div className="note">
          We do not currently use any advertising network or third-party tracking or analytics
          service. Free accounts will eventually see an ad-supported placement as part of our
          business model, but no advertising partner is connected today.
        </div>

        <h2>Payments</h2>
        <p>
          Would You Please is currently free to use while in Private Testing. We have not yet
          launched paid subscriptions or connected a payment processor, so we do not collect or
          store any billing or payment card information today. This policy will be updated with
          the relevant details before that changes.
        </p>

        <h2>Data retention</h2>
        <p>
          We retain your account information for as long as your account is active. Our product
          is designed around a shorter retention period for free accounts as this feature is
          completed; until then, free and paid accounts are retained on the same basis. You can
          delete individual Contacts, Requests, ToDos, and Attachments yourself at any time within
          the app, and you can request deletion of your entire account by contacting us (below).
        </p>

        <h2>Security</h2>
        <p>
          Your data is protected by database-level access rules that restrict every account to
          its own information. Recipients who respond without an account use a secure, revocable
          link rather than open access to any data. Attachments are stored in a private location,
          not a publicly browsable one. The site is served over an encrypted (HTTPS) connection.
          No method of storage or transmission is 100% secure, but we work to protect your
          information using industry-standard practices.
        </p>

        <h2>Cookies and local storage</h2>
        <p>
          We do not use third-party advertising or tracking cookies. We use your browser&rsquo;s
          own local storage only for your convenience &mdash; for example, remembering a
          &ldquo;Keep me signed in&rdquo; preference, your last-used sign-in email, and filter or
          sort choices on your own device. This information stays on your device and is not sent
          to us or any third party.
        </p>

        <h2>Children&rsquo;s privacy</h2>
        <p>
          Would You Please is not directed to children, and we do not knowingly collect
          information from children under 13. If you believe a child has provided us with
          personal information, please contact us and we will remove it.
        </p>

        <h2>Your choices</h2>
        <p>
          You can review, edit, or delete your Contacts, Requests, ToDos, Dialog entries, and
          Attachments at any time from within the app. To request a copy of your data, ask us to
          delete your account, or ask us to remove a Contact&rsquo;s information you no longer
          have a use for, email us at the address below.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          We may update this policy as the product changes. We&rsquo;ll update the effective date
          above when we do.
        </p>

        <h2>Contact us</h2>
        <p>
          Questions about this policy or your data? Email{' '}
          <a href="mailto:notifications@wouldyouplease.com">notifications@wouldyouplease.com</a>.
        </p>
      </main>

      <footer className="pfoot">
        <div className="wrap">
          <span>&#169; 2026 Would You Please</span>
          <span>wouldyouplease.com</span>
        </div>
      </footer>
    </div>
  )
}
