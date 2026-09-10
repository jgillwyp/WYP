'use client'

import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import AppFooter from './AppFooter'
import { APP_VERSION, BUILD_DATE } from '@/version'

function formatBuildDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default function AboutForm() {
  const router = useRouter()

  return (
    <div className="frame-none">
      <div className="app about">
        <WypHeader />

        <div className="band">
          <span className="glabel">About</span>
          <span className="bandcluster">
            <button className="btn" type="button" onClick={() => router.push('/')}>
              Close
            </button>
          </span>
        </div>

        <div className="scroll">
          <div className="about-idblock">
            <div className="about-idrow">
              <span className="about-idlab">Version</span>
              <span className="about-idval">{APP_VERSION}</span>
            </div>
            <div className="about-idrow">
              <span className="about-idlab">Date</span>
              <time className="about-idval" dateTime={BUILD_DATE}>
                {formatBuildDate(BUILD_DATE)}
              </time>
            </div>
          </div>

          <section className="about-section">
            <h2 className="about-section-heading">Private Testing</h2>
            <p className="about-section-copy">
              Would You Please is currently in Private Testing, ahead of the launch of
              the live application. During Private Testing there are no subscription
              costs — every available feature is open to you. When the live application
              becomes available, Private Testers will be given 30 days&apos; notice to
              decide whether to continue as a Free account or a Subscribed account.
            </p>
          </section>

          <section className="about-section">
            <h2 className="about-section-heading">Suggestions &amp; Feedback</h2>
            <p className="about-section-copy">
              You&apos;re a Private Tester — if you have a suggestion, question, or hit a problem,
              we&apos;d like to hear it.
            </p>
            <div className="about-feedback-row">
              <a
                className="btn"
                href={`mailto:feedback@wouldyouplease.com?subject=${encodeURIComponent(`WYP Feedback — v${APP_VERSION}`)}`}
              >
                Send Feedback
              </a>
              <span>
                or email{' '}
                <a href="mailto:feedback@wouldyouplease.com">feedback@wouldyouplease.com</a>
              </span>
            </div>
          </section>

        </div>
        <AppFooter subscriptionDisabled={false} />
      </div>
    </div>
  )
}
