'use client'

import RequestResponseForm from '../../components/RequestResponseForm'

// No RequireAuth — this is the one route in the app an anonymous,
// unauthenticated visitor reaches (the recipient of a Request, via the
// secure link). See RequestResponseForm.tsx for the full data-flow comment.
export default function RequestResponsePage() {
  return <RequestResponseForm />
}
