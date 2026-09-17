'use client'

// Accounts Activity screen (Statistics section, gated on profiles.is_admin
// -- see RequireAdmin.tsx and docs/WYP_Admin_Statistics_Plan.md). 5th admin
// stats screen, added same-session on top of the original four (Jim:
// "there should be another activity screen 'Accounts' to show by-period
// new free and new subscribed accounts and a total new accounts").
//
// Otherwise the same shape as AdminContactsStatsForm.tsx, with two
// deliberate differences: no cohort/profile split (AdminStatsFilterBar's
// cohortOptions is narrowed to ['all', 'beta'] -- 'profile' is degenerate
// for a "how many accounts were created" metric, and 'free'/'subscriber'
// would just be the screen's own two columns), and no events dependency --
// admin_stats_accounts() reads straight off auth.users, since accounts are
// never hard-deleted in this app (see that migration's own comment).
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
  type ChartRow,
  type Cohort,
  type Granularity,
} from './AdminStatsShared'

type Row = {
  period_start: string
  period_end: string
  new_free: number
  new_subscribed: number
  total: number
}

const COHORT_OPTIONS: Cohort[] = ['all', 'beta']

export default function AdminAccountsStatsForm() {
  const router = useRouter()

  const [fromMonth, setFromMonth] = useState(defaultFromMonth())
  const [toMonth, setToMonth] = useState(defaultToMonth())
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [cohort, setCohort] = useState<Cohort>('all')

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      const { data, error } = await supabase.rpc('admin_stats_accounts', {
        p_from: monthToFromDate(fromMonth),
        p_to: monthToToDate(toMonth),
        p_granularity: granularity,
        p_cohort: cohort,
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
  }, [fromMonth, toMonth, granularity, cohort])

  // Chronologically ascending — kept this way for rangeLabel's own "earliest
  // – latest" phrasing below; reverseForDisplay() produces the newest-to-
  // oldest copy StatTable actually renders (2026-09-12).
  const periods = rows.map((r) => r.period_start)
  const chartRows: ChartRow[] = [
    { key: 'new_free', label: 'New Free', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.new_free) },
    { key: 'new_subscribed', label: 'New Subscribed', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.new_subscribed) },
    { key: 'total', label: 'Total', color: 'var(--brand-blue)', kind: 'bar', values: rows.map((r) => r.total) },
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
        entity: 'accounts',
        from: monthToFromDate(fromMonth),
        to: monthToToDate(toMonth),
        granularity,
        cohort,
      })
      const res = await fetch(`/api/admin/stats/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'wyp-accounts-activity.xlsx'
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
          <span className="glabel">Accounts — Activity</span>
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
          profileId=""
          onProfileId={() => {}}
          profiles={[]}
          profilesLoading={false}
          cohortOptions={COHORT_OPTIONS}
        />

        <div className="scroll">
          {loading && <div className="subempty">Loading…</div>}
          {!loading && loadError && <div className="subempty">{loadError}</div>}
          {!loading && !loadError && rows.length === 0 && (
            <div className="subempty">No data in this range.</div>
          )}
          {!loading && !loadError && rows.length > 0 && (
            <StatTable periods={display.periods} granularity={granularity} rows={display.rows} />
          )}
        </div>
      </div>

      {/* Print rendering -- same .no-print/.print-report split as every
          other admin stats screen. */}
      {rows.length > 0 && (
        <div className="print-report">
          <div className="ptitle">Accounts — Activity ({rangeLabel})</div>
          <StatTable periods={display.periods} granularity={granularity} rows={display.rows} />
        </div>
      )}
    </div>
  )
}
