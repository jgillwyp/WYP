import TextMessagingDemoForm from '../../components/TextMessagingDemoForm'

// Plain Server Component, no params/searchParams, no 'use client', no
// Suspense — deliberately, see TextMessagingDemoForm.tsx's own header
// comment. This guarantees the full opt-in form markup Twilio needs to
// review is present in the initial HTML response to any request, with no
// client JS required to see it. No RequireAuth, same as /textmessaging
// and /privacy.
export default function TextMessagingDemoPage() {
  return <TextMessagingDemoForm />
}
