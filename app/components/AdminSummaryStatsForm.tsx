'use client'

// Sum and Averages screen (Statistics section, gated on profiles.is_admin
// — see RequireAdmin.tsx and docs/WYP_Admin_Statistics_Plan.md). The
// fourth and last admin screen — a point-in-time snapshot ("as of" a
// single date) rather than a per-period range, so it uses
// AdminAsOfFilterBar instead of AdminStatsFilterBar and has no chart
// stack at all: Grand Totals render as KPI stat tiles, the per-account
// roster as a plain table — both per the plan's own chart-treatment note
// that a cumulative snapshot isn't a "this many happened in week X" bar.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import {
  AdminAsOfFilterBar,
  PrintIconButton,
  StatTile,
  todayISODate,
  useAdminProfiles,
  type Cohort,
} from './AdminStatsShared'

type Totals = {
  user_count: number
  requests_total: number
  dialog_total: number
  avg_dialog_per_request: number | null
  avg_dialog_per_todo: number | null
  attachments_total_count: number
  attachments_total_size_kb: number
  avg_request_description_size: number | null
  todos_total: number
  avg_todo_description_size: number | null
}

type RosterRow = {
  account_id: string
  email: string
  display_name: string | null
  contact_count: number
  requests_sent_total: number
  requests_sent_open: number
  requests_sent_overdue: number
  requests_sent_done: number
  requests_sent_archived: number
  requests_received_total: number
  requests_received_open: number
  requests_received_overdue: number
  requests_received_done: number
  requests_received_archived: number
  dialog_count: number
  attachments_count: number
  attachments_avg_size_kb: number | null
  todos_total: number
  todos_open: number
  todos_done: number
  todos_archived: number
}

function n(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : String(v)
}

export default function AdminSummaryStatsForm() {
  const router = useRouter()

  const [asOf, setAsOf] = useState(todayISODate())
  const [cohort, setCohort] = useState<Cohort>('all')
  const [profileId, setProfileId] = useState('')
  const { profiles, loading: profilesLoading } = useAdminProfiles()

  const [totals, setTotals] = useState<Totals | null>(null)
  const [roster, setRoster] = useState<RosterRow[]>([])
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
      const [totalsRes, rosterRes] = await Promise.all([
        supabase.rpc('admin_stats_summary_totals', {
          p_asof: asOf,
          p_cohort: cohort,
          p_profile_id: cohort === 'profile' ? profileId : null,
        }),
        supabase.rpc('admin_stats_summary_roster', {
          p_asof: asOf,
          p_cohort: cohort,
          p_profile_id: cohort === 'profile' ? profileId : null,
        }),
      ])
      if (cancelled) return
      if (totalsRes.error) {
        setLoadError(totalsRes.error.message)
      } else if (rosterRes.error) {
        setLoadError(rosterRes.error.message)
      } else {
        const row = Array.isArray(totalsRes.data) ? totalsRes.data[0] : totalsRes.data
        setTotals((row ?? null) as Totals | null)
        setRoster((rosterRes.data ?? []) as RosterRow[])
      }
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [asOf, cohort, profileId, needsProfile])

  const showLoading = loading && !needsProfile

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
        entity: 'summary',
        asOf,
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
      a.download = 'wyp-sum-and-averages.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  function rosterTable() {
    return (
      <div className="stattablewrap">
        <table className="stattable">
          <thead>
            <tr>
              <th>Account</th>
              <th>Contacts</th>
              <th>Sent Total</th>
              <th>Sent Open</th>
              <th>Sent Overdue</th>
              <th>Sent Done</th>
              <th>Sent Archived</th>
              <th>Recv Total</th>
              <th>Recv Open</th>
              <th>Recv Overdue</th>
              <th>Recv Done</th>
              <th>Recv Archived</th>
              <th>Dialog</th>
              <th>Attachments</th>
              <th>Avg Size (KB)</th>
              <th>ToDos Total</th>
              <th>ToDos Open</th>
              <th>ToDos Done</th>
              <th>ToDos Archived</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.account_id}>
                <td>{r.display_name ? `${r.display_name} — ${r.email}` : r.email}</td>
                <td>{n(r.contact_count)}</td>
                <td>{n(r.requests_sent_total)}</td>
                <td>{n(r.requests_sent_open)}</td>
                <td>{n(r.requests_sent_overdue)}</td>
                <td>{n(r.requests_sent_done)}</td>
                <td>{n(r.requests_sent_archived)}</td>
                <td>{n(r.requests_received_total)}</td>
                <td>{n(r.requests_received_open)}</td>
                <td>{n(r.requests_received_overdue)}</td>
                <td>{n(r.requests_received_done)}</td>
                <td>{n(r.requests_received_archived)}</td>
                <td>{n(r.dialog_count)}</td>
                <td>{n(r.attachments_count)}</td>
                <td>{n(r.attachments_avg_size_kb)}</td>
                <td>{n(r.todos_total)}</td>
                <td>{n(r.todos_open)}</td>
                <td>{n(r.todos_done)}</td>
                <td>{n(r.todos_archived)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="frame-none">
      <div className="app no-print">
        <WypHeader action={<PrintIconButton onClick={handlePrint} />} />
        <div className="band">
          <span className="glabel">Sum and Averages</span>
          <span className="bandcluster">
            <button className="btn-secondary" type="button" onClick={handleExport} disabled={exporting || loading}>
              {exporting ? 'Exporting…' : 'Export .xlsx'}
            </button>
            <button className="btn" type="button" onClick={() => router.back()}>
              Close
            </button>
          </span>
        </div>

        <AdminAsOfFilterBar
          asOf={asOf}
          onAsOf={setAsOf}
          cohort={cohort}
          onCohort={setCohort}
          profileId={profileId}
          onProfileId={setProfileId}
          profiles={profiles}
          profilesLoading={profilesLoading}
        />

        <div className="scroll">
          {needsProfile && <div className="subempty">Choose an account above to see its totals.</div>}
          {!needsProfile && showLoading && <div className="subempty">Loading…</div>}
          {!needsProfile && !showLoading && loadError && <div className="subempty">{loadError}</div>}
          {!needsProfile && !showLoading && !loadError && totals && (
            <>
              <div className="statsectionlabel">Grand Totals</div>
              <div className="stattilerow">
                <StatTile label="Accounts" value={n(totals.user_count)} />
                <StatTile label="Requests" value={n(totals.requests_total)} />
                <StatTile label="Dialog" value={n(totals.dialog_total)} />
                <StatTile label="Avg Dialog / Request" value={n(totals.avg_dialog_per_request)} />
                <StatTile label="Avg Dialog / ToDo" value={n(totals.avg_dialog_per_todo)} />
                <StatTile label="Attachments" value={n(totals.attachments_total_count)} sub={`${n(totals.attachments_total_size_kb)} KB total`} />
                <StatTile label="Avg Request Description" value={n(totals.avg_request_description_size)} sub="characters" />
                <StatTile label="ToDos" value={n(totals.todos_total)} sub={`avg description ${n(totals.avg_todo_description_size)} chars`} />
              </div>

              <div className="statsectionlabel">Per-Account Roster</div>
              {rosterTable()}
            </>
          )}
        </div>
      </div>

      {totals && !needsProfile && (
        <div className="print-report">
          <div className="ptitle">Sum and Averages (as of {asOf})</div>
          <div className="statsectionlabel" style={{ margin: '10px 0' }}>Grand Totals</div>
          <div className="stattablewrap">
            <table className="stattable">
              <tbody>
                <tr><td>Accounts</td><td>{n(totals.user_count)}</td></tr>
                <tr><td>Requests</td><td>{n(totals.requests_total)}</td></tr>
                <tr><td>Dialog</td><td>{n(totals.dialog_total)}</td></tr>
                <tr><td>Avg Dialog / Request</td><td>{n(totals.avg_dialog_per_request)}</td></tr>
                <tr><td>Avg Dialog / ToDo</td><td>{n(totals.avg_dialog_per_todo)}</td></tr>
                <tr><td>Attachments</td><td>{n(totals.attachments_total_count)} ({n(totals.attachments_total_size_kb)} KB)</td></tr>
                <tr><td>Avg Request Description</td><td>{n(totals.avg_request_description_size)} chars</td></tr>
                <tr><td>ToDos</td><td>{n(totals.todos_total)} (avg description {n(totals.avg_todo_description_size)} chars)</td></tr>
              </tbody>
            </table>
          </div>
          <div className="statsectionlabel" style={{ margin: '14px 0 0' }}>Per-Account Roster</div>
          {rosterTable()}
        </div>
      )}
    </div>
  )
}
