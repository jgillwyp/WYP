'use client'

// Private Testing Close (2026-11-16, migration 098, §6.48 PROPOSED) — the
// admin control for the open-signup free trial built alongside Apple
// TestFlight review readiness (see CLAUDE.md's 2026-11-16 entries for the
// full background). Jim's own committed floor: scheduling a close always
// gives every current trial account at least 30 days' notice by email,
// enforced server-side by schedule_trial_close() — this screen's own
// client-side >= 30 days check is a courtesy, not the real gate.
//
// Deliberately minimal: a date field, a live count of how many accounts a
// close would actually affect (admin_get_trial_subscriber_count()), the
// currently scheduled date (if any, get_trial_close_date()), and two
// buttons — Schedule and, only once a date is already scheduled, Cancel
// Schedule. The actual email send happens server-side
// (app/api/admin/schedule-trial-close/route.ts); this screen only reports
// how many were notified once the call returns.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase, getCurrentUser } from '@/lib/supabaseClient'

const MIN_DAYS_OUT = 30

function todayPlusDaysISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function AdminTrialCloseForm() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [scheduledDate, setScheduledDate] = useState<string | null>(null)
  const [trialCount, setTrialCount] = useState<number | null>(null)
  const [closeDate, setCloseDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data: userData } = await getCurrentUser()
      if (!userData.user) return
      const [dateRes, countRes] = await Promise.all([
        supabase.rpc('get_trial_close_date'),
        supabase.rpc('admin_get_trial_subscriber_count'),
      ])
      if (cancelled) return
      setScheduledDate((dateRes.data as string | null) ?? null)
      setTrialCount((countRes.data as number | null) ?? null)
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

  async function submit(nextCloseDate: string | null) {
    setSaving(true)
    setError(null)
    setResult(null)

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      setError('Not signed in.')
      setSaving(false)
      return
    }

    const res = await fetch('/api/admin/schedule-trial-close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ closeDate: nextCloseDate }),
    })
    const json = await res
      .json()
      .catch(() => ({}) as { ok?: boolean; error?: string; detail?: string; notified?: number })

    setSaving(false)

    if (!res.ok || !json.ok) {
      setError(json.detail || json.error || 'Could not schedule the close.')
      return
    }

    setScheduledDate(nextCloseDate)
    const [countRes] = await Promise.all([supabase.rpc('admin_get_trial_subscriber_count')])
    setTrialCount((countRes.data as number | null) ?? null)
    setResult(
      nextCloseDate
        ? `Scheduled for ${nextCloseDate}. Notified ${json.notified ?? 0} account(s) on the trial.`
        : 'Scheduled close canceled. Pre-Release Testing continues indefinitely.'
    )
    setCloseDate('')
  }

  const minDate = todayPlusDaysISO(MIN_DAYS_OUT)
  const canSchedule = closeDate !== '' && closeDate >= minDate

  if (loading) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="band">
            <span className="glabel">Pre-Release Testing Close</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">Pre-Release Testing Close</span>
          <span className="bandcluster">
            <button className="btn-secondary" type="button" onClick={handleClose}>
              Close
            </button>
          </span>
        </div>

        <div className="scroll">
          <div className="form">
            <p className="subnote">
              New signups while no close date is scheduled get full, free Subscriber-tier access as
              part of Pre-Release Testing. Scheduling a close always gives every account currently on
              the trial at least {MIN_DAYS_OUT} days&rsquo; notice by email before it ends.
            </p>

            <div className="metarow">
              <span className="mlabel">Currently on the trial</span>
              <span className="mval">{trialCount ?? '—'}</span>
            </div>
            <div className="metarow">
              <span className="mlabel">Scheduled close date</span>
              <span className="mval">{scheduledDate ?? 'None — open indefinitely'}</span>
            </div>

            {result && <p className="subnote">{result}</p>}
            {error && (
              <p className="ferror" role="alert">
                {error}
              </p>
            )}

            <div className="fgroup ffloat">
              <input
                className="finput opt"
                id="trial-close-date"
                type="date"
                min={minDate}
                value={closeDate}
                onChange={(e) => setCloseDate(e.target.value)}
              />
              <label className="flabel" htmlFor="trial-close-date">
                New close date (at least {MIN_DAYS_OUT} days out)
              </label>
            </div>

            <div className="modalacts" style={{ marginTop: 12 }}>
              {scheduledDate && (
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => submit(null)}
                >
                  Cancel Scheduled Close
                </button>
              )}
              <button className="btn" type="button" disabled={saving || !canSchedule} onClick={() => submit(closeDate)}>
                {saving ? 'Scheduling…' : 'Schedule Close'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
