'use client'

// Feature Usage (2026-11-23, migration 103; widened to all 13 tracked
// features, migration 104, same day) — Jim: "I am interested in
// automatically keeping track of app usage within Checklist (add a 'Add a
// Dialog entry'). This could potentially be used on an ongoing basis (and
// reported back for product development)." — then, once Dialog Entry alone
// was live: "the only feature I see tracked is Dialog Entry. I expected
// all features to be tracked." Built on the same shared primitives
// (AdminStatsShared.tsx) every other Admin Activity screen already uses —
// admin_get_feature_usage() mirrors admin_get_ad_activity()'s own Sunday-
// week/calendar-month bucketing exactly — and the full cohort set (free/
// subscriber included — unlike Ad Activity's own narrower set, a
// free-vs-subscriber usage split is exactly the kind of thing this screen
// exists to answer for product development) rather than the
// ad-only-ever-shown-to-Free narrowing that screen applies.
//
// FEATURE_COLUMNS is the one place this screen's own 13-column list is
// spelled out — see featureUsage.ts's own header comment for the full
// one-line-per-feature mapping back to the Tester Checklist's own rows,
// and for what a future 14th feature needs (a migration first, then one
// more entry here).
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { printWithExpandedWindow } from '@/lib/platform'
import type { TrackedFeature } from '@/lib/featureUsage'
import {
  AdminStatsFilterBar,
  PrintIconButton,
  StatTable,
  defaultFromMonth,
  defaultToMonth,
  formatPeriodLabel,
  monthToFromDate,
  monthToToDate,
  reverseForDisplay,
  useAdminProfiles,
  type ChartRow,
  type Cohort,
  type Granularity,
} from './AdminStatsShared'

const FEATURE_COLUMNS: { key: TrackedFeature; label: string }[] = [
  { key: 'dialog_entry', label: 'Dialog Entry' },
  { key: 'request_created', label: 'Request Created' },
  { key: 'todo_created', label: 'ToDo Created' },
  { key: 'request_responded', label: 'Request Responded' },
  { key: 'attachment_added', label: 'Attachment Added' },
  { key: 'voice_dictation', label: 'Voice Dictation' },
  { key: 'receipt_confirmation', label: 'Receipt Confirmation' },
  { key: 'request_texting', label: 'Request Texting' },
  { key: 'reminder_set', label: 'Reminder Set' },
  { key: 'repeat_set', label: 'Repeat Set' },
  { key: 'calendar_view', label: 'Calendar View' },
  { key: 'archive_used', label: 'Archive Used' },
  { key: 'print_used', label: 'Print Used' },
]

type Row = { period_start: string; period_end: string } & Record<TrackedFeature, number>

export default function AdminFeatureUsageForm() {
  const router = useRouter()

  const [fromMonth, setFromMonth] = useState(defaultFromMonth())
  const [toMonth, setToMonth] = useState(defaultToMonth())
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [cohort, setCohort] = useState<Cohort>('all')
  const [profileId, setProfileId] = useState('')
  const { profiles, loading: profilesLoading } = useAdminProfiles()

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const needsProfile = cohort === 'profile' && !profileId

  useEffect(() => {
    if (needsProfile) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      const { data, error } = await supabase.rpc('admin_get_feature_usage', {
        p_from: monthToFromDate(fromMonth),
        p_to: monthToToDate(toMonth),
        p_granularity: granularity,
        p_cohort: cohort,
        p_profile_id: cohort === 'profile' ? profileId : null,
      })
      if (cancelled) return
      if (error) {
        setLoadError(error.message)
        setRows([])
      } else {
        setRows((data ?? []) as Row[])
      }
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [fromMonth, toMonth, granularity, cohort, profileId, needsProfile])

  const periods = rows.map((r) => r.period_start)
  // Color is a vestige of ChartRow's own type — StatTable only ever renders
  // a plain table (the bar/line chart primitives it originally fed were
  // removed 2026-09-12), so every column shares one value harmlessly, same
  // as every other wide admin screen with no colored chart of its own
  // (Requests/ToDos Activity).
  const chartRows: ChartRow[] = FEATURE_COLUMNS.map((col) => ({
    key: col.key,
    label: col.label,
    color: 'var(--brand-blue)',
    kind: 'bar',
    values: rows.map((r) => r[col.key]),
  }))
  const display = reverseForDisplay(periods, chartRows)

  function handlePrint() {
    printWithExpandedWindow()
  }

  async function handleExport() {
    setExporting(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      const params = new URLSearchParams({
        entity: 'feature_usage',
        from: monthToFromDate(fromMonth),
        to: monthToToDate(toMonth),
        granularity,
        cohort,
        profileId: cohort === 'profile' ? profileId : '',
      })
      const res = await fetch(`/api/admin/stats/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'wyp-feature-usage.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const rangeLabel = rows.length > 0
    ? `${formatPeriodLabel(periods[0], granularity)} – ${formatPeriodLabel(periods[periods.length - 1], granularity)}`
    : ''

  const showLoading = loading && !needsProfile

  return (
    <div className="frame-none">
      <div className="app no-print">
        <WypHeader action={<PrintIconButton onClick={handlePrint} />} />
        <div className="band">
          <span className="glabel">Feature Usage</span>
          <span className="bandcluster">
            <button className="btn-secondary" type="button" onClick={handleExport} disabled={exporting || loading}>
              {exporting ? 'Exporting…' : 'Export .xlsx'}
            </button>
            <button className="btn" type="button" onClick={() => router.back()}>
              Close
            </button>
          </span>
        </div>

        <AdminStatsFilterBar
          fromMonth={fromMonth}
          toMonth={toMonth}
          onFromMonth={setFromMonth}
          onToMonth={setToMonth}
          granularity={granularity}
          onGranularity={setGranularity}
          cohort={cohort}
          onCohort={setCohort}
          profileId={profileId}
          onProfileId={setProfileId}
          profiles={profiles}
          profilesLoading={profilesLoading}
        />

        <div className="scroll">
          {needsProfile && <div className="subempty">Choose an account above to see its Feature Usage.</div>}
          {!needsProfile && showLoading && <div className="subempty">Loading…</div>}
          {!needsProfile && !showLoading && loadError && <div className="subempty">{loadError}</div>}
          {!needsProfile && !showLoading && !loadError && rows.length === 0 && (
            <div className="subempty">No data in this range.</div>
          )}
          {!needsProfile && !showLoading && !loadError && rows.length > 0 && (
            <StatTable periods={display.periods} granularity={granularity} rows={display.rows} />
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="print-report">
          <div className="ptitle">Feature Usage ({rangeLabel})</div>
          <StatTable periods={display.periods} granularity={granularity} rows={display.rows} />
        </div>
      )}
    </div>
  )
}
