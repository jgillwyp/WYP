'use client'

import { Suspense } from 'react'

import TextMessagingForm from '../components/TextMessagingForm'

// No RequireAuth — the second (after /r/[token]) route an anonymous,
// unauthenticated visitor reaches, via the "please approve text
// messaging" email. See TextMessagingForm.tsx for the full data-flow
// comment. Suspense boundary required by TextMessagingForm's own
// useSearchParams() call (same precedent as app/login/page.tsx).
export default function TextMessagingPage() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <TextMessagingForm />
    </Suspense>
  )
}
