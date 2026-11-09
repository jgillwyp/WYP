'use client'

import RequireTester from '../../RequireTester'
import AdminTestStripeForm from '../../components/AdminTestStripeForm'

// Gate changed from RequireAdmin to RequireTester, 2026-11-09 — this screen
// moved onto the Private Tester menu (MainScreen.tsx), so any account on
// tier_toggle_allowlist can reach it now, not just the admin account. The
// URL/path is left as /admin/stripe-test to avoid touching every existing
// link into it (Admin tab's own row included) for a rename with no other
// behavior change.
export default function AdminTestStripePage() {
  return (
    <RequireTester>
      <AdminTestStripeForm />
    </RequireTester>
  )
}
