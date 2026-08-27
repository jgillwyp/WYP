'use client'

import { linkifySegments } from '@/lib/attachments'

/**
 * Renders read-only text (a Request/ToDo's Description, or a Dialog entry's
 * body) with any URL-shaped word turned into a real clickable link —
 * 2026-08-26, Jim's own Request/ToDo-symmetry proposal: "could the
 * descriptive text in a ToDo and in a Request be enhanced to convert URL
 * text into links where appropriate? If so, there would not be a need for
 * 'adding a URL' to a ToDo as a separate feature." Uses the same
 * bare-domain/scheme detection Locations already used (linkifySegments,
 * app/src/lib/attachments.ts) so "ft.com" and "https://ft.com" are both
 * recognized identically to how a Location field always was.
 *
 * Only ever used on screens/fields that show Description or Dialog body as
 * static text — every Description field in this app is otherwise a live,
 * editable <textarea>, which this component never touches; linkifying an
 * editable field would fight the cursor and selection.
 */
export default function Linkified({ text }: { text: string }) {
  const segments = linkifySegments(text)
  return (
    <>
      {segments.map((seg, i) =>
        seg.href ? (
          <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer">
            {seg.text}
          </a>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  )
}
