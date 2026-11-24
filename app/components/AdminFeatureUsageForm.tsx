'use client'

// Feature Usage (2026-11-23, migration 103) — Jim: "I am interested in
// automatically keeping track of app usage within Checklist (add a 'Add a
// Dialog entry'). This could potentially be used on an ongoing basis (and
// reported back for product development)." Built on the same shared
// primitives (AdminStatsShared.tsx) every other Admin Activity screen
// already uses — admin_get_feature_usage() mirrors admin_get_ad_activity()'s
// own Sunday-week/calendar-month bucketing exactly, so this screen is a
// straight port of AdminAdActivityForm.tsx's own shape, just with one
// tracked-feature column (Dialog Entry) instead of impressions/clicks, and
// the full cohort set (free/subscriber included — unlike Ad Activity's own
// narrower set, a free-vs-subscriber usage split is exactly the kind of
// thing this screen exists to answer for product development) rather than
// the ad-only-ever-shown-to-Free narrowing that screen applies.
//
// The first tracked feature is Dialog entries (dialog_entry) — see
// featureUsage.ts's own header comment for how a future feature gets
// added here: a new migration extending the table's CHECK constraint and
// this RPC's own column list (drop-then-create, same RETURNS TABLE
// precedent every other addition in this schema already uses), a new
// column added to the Row type/chartRows below, and a new client call
// site wired wherever that action happens.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { printWithExpandedWindow } from '@/lib/platform'
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

type Row = {
  period_start: string
  period_end: string
  dialog_entry: number
}

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
  const chartRows: ChartRow[] = [
    { key: 'dialog_entry', label: 'Dialog Entry', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.dialog_entry) },
  ]
  const display = reverseForDisplay(periods, chartRows)

  const totalDialogEntries = rows.reduce((sum, r) => sum + r.dialog_entry, 0)

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
            <>
              <div className="metarow" style={{ padding: '0 var(--pad)' }}>
                <span className="mlabel">Dialog Entry Total</span>
                <span className="mval">{totalDialogEntries}</span>
              </div>
              <StatTable periods={display.periods} granularity={granularity} rows={display.rows} />
            </>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="print-report">
          <div className="ptitle">Feature Usage ({rangeLabel})</div>
          <div style={{ fontSize: 11, marginBottom: 8 }}>Dialog Entry Total: {totalDialogEntries}</div>
          <StatTable periods={display.periods} granularity={granularity} rows={display.rows} />
        </div>
      )}
    </div>
  )
}
