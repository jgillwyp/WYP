'use client'

// ToDos Activity screen (Statistics section, gated on profiles.is_admin —
// see RequireAdmin.tsx and docs/WYP_Admin_Statistics_Plan.md). Same shape
// as AdminRequestsStatsForm.tsx, minus the Sent/Received toggle — a ToDo
// has no recipient, so every metric here is single-sided.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
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
  created: number
  changed: number
  done: number
  deleted: number
  archived: number
  unarchived: number
  attachments: number
  dialog: number
}

export default function AdminTodosStatsForm() {
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
      const { data, error } = await supabase.rpc('admin_stats_todos', {
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
  const showLoading = loading && !needsProfile

  const chartRows: ChartRow[] = [
    { key: 'created', label: 'Created', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.created) },
    { key: 'changed', label: 'Changed', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.changed) },
    { key: 'done', label: 'Done', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.done) },
    { key: 'deleted', label: 'Deleted', color: 'var(--alert-red)', kind: 'bar', values: rows.map((r) => r.deleted) },
    { key: 'archived', label: 'Archived', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.archived) },
    { key: 'unarchived', label: 'Unarchived', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.unarchived) },
    { key: 'attachments', label: 'Attachments', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.attachments) },
    { key: 'dialog', label: 'Dialog', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.dialog) },
  ]
  const display = reverseForDisplay(periods, chartRows)

  function handlePrint() {
    window.print()
  }

  async function handleExport() {
    setExporting(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      const params = new URLSearchParams({
        entity: 'todos',
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
      a.download = 'wyp-todos-activity.xlsx'
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

  return (
    <div className="frame-none">
      <div className="app no-print">
        <WypHeader action={<PrintIconButton onClick={handlePrint} />} />
        <div className="band">
          <span className="glabel">ToDos — Activity</span>
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
          {needsProfile && <div className="subempty">Choose an account above to see its ToDos activity.</div>}
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
          <div className="ptitle">ToDos — Activity ({rangeLabel})</div>
          <StatTable periods={display.periods} granularity={granularity} rows={display.rows} />
        </div>
      )}
    </div>
  )
}
