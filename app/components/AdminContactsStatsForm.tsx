'use client'

// Contacts Activity screen (Statistics section, gated on profiles.is_admin
// — see RequireAdmin.tsx and docs/WYP_Admin_Statistics_Plan.md). Built
// first of the four admin screens (simplest — no Sent/Received split);
// AdminStatsShared.tsx's chart/table/filter primitives were designed
// against this screen and are reused as-is by Requests/ToDos/Sum and
// Averages.
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
  added: number
  deleted: number
  with_phone: number
  with_notes: number
  total: number
}

export default function AdminContactsStatsForm() {
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
      const { data, error } = await supabase.rpc('admin_stats_contacts', {
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

  // Chronologically ascending — kept this way for rangeLabel's own "earliest
  // – latest" phrasing below; reverseForDisplay() produces the newest-to-
  // oldest copy StatTable actually renders (2026-09-12).
  const periods = rows.map((r) => r.period_start)
  const chartRows: ChartRow[] = [
    { key: 'added', label: 'Added', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.added) },
    { key: 'deleted', label: 'Deleted', color: 'var(--alert-red)', kind: 'bar', values: rows.map((r) => r.deleted) },
    { key: 'phone', label: 'With Phone', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.with_phone) },
    { key: 'notes', label: 'With Notes', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.with_notes) },
    { key: 'total', label: 'Total', color: 'var(--brand-blue)', kind: 'line', values: rows.map((r) => r.total) },
  ]
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
        entity: 'contacts',
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
      a.download = 'wyp-contacts-activity.xlsx'
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
          <span className="glabel">Contacts — Activity</span>
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
          {needsProfile && <div className="subempty">Choose an account above to see its Contacts activity.</div>}
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

      {/* Print rendering (2026-09-07) — same .no-print/.print-report split
          every other detail screen already uses (RequestDetailForm.tsx,
          TodoDetailForm.tsx, MainScreen.tsx). StatTable is now the only
          rendering of these rows anywhere (the on-screen chart was removed
          2026-09-12), so this was already unaffected by that change. */}
      {rows.length > 0 && (
        <div className="print-report">
          <div className="ptitle">Contacts — Activity ({rangeLabel})</div>
          <StatTable periods={display.periods} granularity={granularity} rows={display.rows} />
        </div>
      )}
    </div>
  )
}
