'use client'

// Ad Activity (2026-11-15, migration 097) — the report Jim asked for
// ("an Admin 'Ad Activity' report, impressions/clicks by date, with
// week/month totals") once the real sample ad + /ad-landing destination
// page existed to generate any data for it. Built on the exact same
// shared primitives (AdminStatsShared.tsx) every other Admin Activity
// screen already uses — admin_get_ad_activity() mirrors
// admin_stats_contacts()'s own Sunday-week/calendar-month bucketing, so
// this screen is a straight port of AdminContactsStatsForm.tsx's own
// shape, not a bespoke build.
//
// Cohort here means "whose impressions/clicks count" — every ad viewer is
// Free by construction (the slot only ever renders for tier === 'free'),
// so 'free'/'subscriber' would be meaningless choices and are left out of
// cohortOptions below; the RPC itself still accepts them (schema-shape
// parity with the other three admin_stats_* functions) but they return
// the same rows 'all' would in practice.
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
  impressions: number
  clicks: number
}

export default function AdminAdActivityForm() {
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
      const { data, error } = await supabase.rpc('admin_get_ad_activity', {
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
    { key: 'impressions', label: 'Impressions', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.impressions) },
    { key: 'clicks', label: 'Clicks', color: 'var(--alert-red)', kind: 'bar', values: rows.map((r) => r.clicks) },
  ]
  const display = reverseForDisplay(periods, chartRows)

  const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0)
  const totalClicks = rows.reduce((sum, r) => sum + r.clicks, 0)
  const clickThroughRate =
    totalImpressions > 0 ? `${((totalClicks / totalImpressions) * 100).toFixed(1)}%` : '—'

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
        entity: 'ad_activity',
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
      a.download = 'wyp-ad-activity.xlsx'
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
          <span className="glabel">Ad Activity</span>
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
          cohortOptions={['all', 'beta', 'profile']}
        />

        <div className="scroll">
          {needsProfile && <div className="subempty">Choose an account above to see its Ad Activity.</div>}
          {!needsProfile && showLoading && <div className="subempty">Loading…</div>}
          {!needsProfile && !showLoading && loadError && <div className="subempty">{loadError}</div>}
          {!needsProfile && !showLoading && !loadError && rows.length === 0 && (
            <div className="subempty">No data in this range.</div>
          )}
          {!needsProfile && !showLoading && !loadError && rows.length > 0 && (
            <>
              <div className="metarow" style={{ padding: '0 var(--pad)' }}>
                <span className="mlabel">Click-Through Rate</span>
                <span className="mval">{clickThroughRate}</span>
              </div>
              <StatTable periods={display.periods} granularity={granularity} rows={display.rows} />
            </>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="print-report">
          <div className="ptitle">Ad Activity ({rangeLabel})</div>
          <div style={{ fontSize: 11, marginBottom: 8 }}>Click-Through Rate: {clickThroughRate}</div>
          <StatTable periods={display.periods} granularity={granularity} rows={display.rows} />
        </div>
      )}
    </div>
  )
}
