'use client'

import Link from 'next/link'

import { nextHelpTopic, type HelpTopicSlug } from './helpTopics'

/** "What to try next" nav — cyclic through the four Help topics. */
export default function HelpNext({ current }: { current: HelpTopicSlug }) {
  const next = nextHelpTopic(current)
  return (
    <div className="help-next">
      <span className="help-next-label">Next up</span>
      <Link className="btn-secondary" href={`/help/${next.slug}`}>
        {next.title} →
      </Link>
    </div>
  )
}
