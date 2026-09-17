'use client'

// Requests Activity screen (Statistics section, gated on profiles.is_admin
// — see RequireAdmin.tsx and docs/WYP_Admin_Statistics_Plan.md). Second of
// the four admin screens, reusing AdminStatsShared.tsx's primitives built
// against Contacts Activity. Adds the Sent/Received toggle Contacts didn't
// need: Created/Changed/Done/Attachments/Dialog each have both sides;
// Deleted/Archived/Unarchived are Sent-only, per the plan — a Received item
// isn't owned by this account, so there's nothing to archive or delete from
// that side. The Created-Deleted/Archived-Unarchived diverging (+/-/net)
// columns this comment used to also mention were dropped 2026-09-12 — see
// AdminStatsShared.tsx's own chart-primitives comment.
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
  sent_created: number
  received_created: number
  sent_changed: number
  received_changed: number
  sent_done: number
  received_done: number
  deleted: number
  archived: number
  unarchived: number
  sent_attachments: number
  received_attachments: number
  sent_dialog: number
  received_dialog: number
}

type Side = 'sent' | 'received'

export default function AdminRequestsStatsForm() {
  const router = useRouter()

  const [fromMonth, setFromMonth] = useState(defaultFromMonth())
  const [toMonth, setToMonth] = useState(defaultToMonth())
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [cohort, setCohort] = useState<Cohort>('all')
  const [profileId, setProfileId] = useState('')
  const { profiles, loading: profilesLoading } = useAdminProfiles()
  const [side, setSide] = useState<Side>('sent')

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
      const { data, error } = await supabase.rpc('admin_stats_requests', {
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
    {
      key: 'created',
      label: 'Created',
      color: 'var(--brand-blue)',
      kind: 'bar',
      values: rows.map((r) => (side === 'sent' ? r.sent_created : r.received_created)),
    },
    {
      key: 'changed',
      label: 'Changed',
      color: 'var(--brand-blue)',
      kind: 'bar',
      values: rows.map((r) => (side === 'sent' ? r.sent_changed : r.received_changed)),
    },
    {
      key: 'done',
      label: 'Done',
      color: 'var(--brand-blue)',
      kind: 'bar',
      values: rows.map((r) => (side === 'sent' ? r.sent_done : r.received_done)),
    },
    { key: 'deleted', label: 'Deleted', color: 'var(--alert-red)', kind: 'bar', values: rows.map((r) => r.deleted) },
    { key: 'archived', label: 'Archived', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.archived) },
    { key: 'unarchived', label: 'Unarchived', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.unarchived) },
    {
      key: 'attachments',
      label: 'Attachments',
      color: 'var(--brand-blue)',
      kind: 'bar',
      values: rows.map((r) => (side === 'sent' ? r.sent_attachments : r.received_attachments)),
    },
    {
      key: 'dialog',
      label: 'Dialog',
      color: 'var(--brand-blue)',
      kind: 'bar',
      values: rows.map((r) => (side === 'sent' ? r.sent_dialog : r.received_dialog)),
    },
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
        entity: 'requests',
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
      a.download = 'wyp-requests-activity.xlsx'
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
          <span className="glabel">Requests — Activity</span>
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

        {/* Sent/Received toggle — only Created/Changed/Done/Attachments/
            Dialog actually move with it; Deleted/Archived/Unarchived are
            Sent-only and stay put either way (see file header comment). */}
        <div className="statfilters no-print" style={{ borderTop: 0 }}>
          <div className="chips" role="tablist" aria-label="Sent or Received">
            <button
              type="button"
              className={`chip${side === 'sent' ? ' sel' : ''}`}
              role="tab"
              aria-selected={side === 'sent'}
              onClick={() => setSide('sent')}
            >
              Sent
            </button>
            <button
              type="button"
              className={`chip${side === 'received' ? ' sel' : ''}`}
              role="tab"
              aria-selected={side === 'received'}
              onClick={() => setSide('received')}
            >
              Received
            </button>
          </div>
          <span className="statfilterlabel">applies to Created / Changed / Done / Attachments / Dialog</span>
        </div>

        <div className="scroll">
          {needsProfile && <div className="subempty">Choose an account above to see its Requests activity.</div>}
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

      {/* Print rendering — table only, same reasoning as
          AdminContactsStatsForm.tsx's own comment. Reflects whichever
          Sent/Received side is currently selected, same as on screen. */}
      {rows.length > 0 && (
        <div className="print-report">
          <div className="ptitle">Requests — Activity ({side === 'sent' ? 'Sent' : 'Received'}, {rangeLabel})</div>
          <StatTable periods={display.periods} granularity={granularity} rows={display.rows} />
        </div>
      )}
    </div>
  )
}
