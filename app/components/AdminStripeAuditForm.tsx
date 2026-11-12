'use client'

// Stripe Audit (2026-11-12, migration 093, §6.48 PROPOSED) — Jim: "create an
// audit of purchase/cancel/reduction transactions that can be tied to
// Stripe by some form of a 'transaction ID' and expose it as a view under
// the Admin chip as 'Account/Stripe Audit'." Read-only — every real Stripe
// money-moving/subscription-modifying action in this app already writes a
// row to stripe_billing_audit (migration 092); this screen is the first
// place any of it is actually shown. admin_get_stripe_audit() derives one
// normalized "transaction ID" per row (whichever real Stripe id — invoice,
// checkout session, or subscription — that event type's own detail jsonb
// happens to carry), rather than a new schema column; see that RPC's own
// header comment.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

type AuditRow = {
  id: number
  created_at: string
  user_email: string | null
  event_type: string
  amount_cents: number | null
  currency: string | null
  stripe_transaction_id: string | null
  detail: Record<string, unknown>
}

// Plain English for each event_type this app's own Stripe routes log —
// falls back to the raw value for any future type this list hasn't caught
// up with yet, so a new event type is never silently hidden.
const EVENT_TYPE_LABEL: Record<string, string> = {
  checkout_completed: 'Sign Up',
  invoice_paid: 'Invoice Paid',
  subscription_canceled: 'Subscription Ended',
  subscription_cancel_scheduled: 'Cancel Scheduled',
  subscription_renewed: 'Renewed',
  subscription_upgraded_to_annual: 'Upgraded to Annual',
  storage_update_confirmed: 'Storage Update',
}

// Local timestamp -> "MM/DD/YY h:mm AM/PM" — real getters, not a UTC slice,
// same reasoning formatMDYFromTimestamp() established elsewhere in this
// codebase (2026-09-03) for a genuine timestamptz column.
function formatRowTimestamp(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  let hours = d.getHours()
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12 || 12
  return `${mm}/${dd}/${yy} ${hours}:${minutes} ${ampm}`
}

function formatAmount(cents: number | null, currency: string | null): string {
  if (cents === null) return '—'
  const dollars = (cents / 100).toFixed(2)
  return currency ? `$${dollars} ${currency.toUpperCase()}` : `$${dollars}`
}

export default function AdminStripeAuditForm() {
  const router = useRouter()

  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error: rpcError } = await supabase.rpc('admin_get_stripe_audit', { p_limit: 200 })
      if (cancelled) return
      if (rpcError) {
        setError(rpcError.message)
        setLoading(false)
        return
      }
      setRows((data as AuditRow[] | null) ?? [])
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  function handleClose() {
    router.back()
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">Stripe Audit</span>
          <button className="btn-secondary" type="button" onClick={handleClose}>
            Close
          </button>
        </div>

        <div className="scroll">
          {loading && <div className="subempty">Loading…</div>}
          {error && (
            <p className="ferror" role="alert" style={{ margin: 'var(--pad)' }}>
              {error}
            </p>
          )}
          {!loading && !error && rows && rows.length === 0 && (
            <div className="subempty">No Stripe transactions recorded yet.</div>
          )}
          {!loading && !error && rows && rows.length > 0 && (
            <div style={{ padding: '0 var(--pad) 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map((row) => (
                <div key={row.id} className="panel">
                  <div className="metarow">
                    <span className="mlabel">Date</span>
                    <span className="mval">{formatRowTimestamp(row.created_at)}</span>
                  </div>
                  <div className="metarow">
                    <span className="mlabel">Type</span>
                    <span className="mval">{EVENT_TYPE_LABEL[row.event_type] ?? row.event_type}</span>
                  </div>
                  <div className="metarow">
                    <span className="mlabel">User</span>
                    <span className="mval">{row.user_email ?? '—'}</span>
                  </div>
                  <div className="metarow">
                    <span className="mlabel">Amount</span>
                    <span className="mval">{formatAmount(row.amount_cents, row.currency)}</span>
                  </div>
                  <div className="metarow">
                    <span className="mlabel">Txn ID</span>
                    <span className="mval" style={{ fontFamily: 'monospace', fontSize: 11.5, wordBreak: 'break-all' }}>
                      {row.stripe_transaction_id ?? '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
