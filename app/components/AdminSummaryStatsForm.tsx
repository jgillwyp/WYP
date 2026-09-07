'use client'

// Sum and Averages screen (Statistics section, gated on profiles.is_admin
// — see RequireAdmin.tsx and docs/WYP_Admin_Statistics_Plan.md). The
// fourth and last admin screen — a point-in-time snapshot ("as of" a
// single date) rather than a per-period range, so it uses
// AdminAsOfFilterBar instead of AdminStatsFilterBar and has no chart
// stack at all: a cumulative snapshot isn't a "this many happened in
// week X" bar.
//
// Reformatted per docs/WYP_Admin_Statistics_Specification_v1_0.docx
// (owner-approved design, 2026-09-07; migration 065). Replaces the
// original Grand-Totals stat-tile block with two stacked totals tables —
// Entities (Accounts, Contacts, Req's Sent, Req's Received, ToDos) and
// Volume (Dialogs, Attachments) — each with a narrow row-label column
// locked in place on the left (.stattable-locked, globals.css) and every
// other column in one horizontally scrolling region, per spec §2.2.
// Percentages and the Volume table's four "average count per" ratios are
// computed here from the raw counts admin_stats_summary_totals() returns
// (pct()/ratio() below), not baked into the RPC, so the on-screen table,
// the print view, and the .xlsx export share one rounding rule instead of
// three independent ones.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import {
  AdminAsOfFilterBar,
  PrintIconButton,
  todayISODate,
  useAdminProfiles,
  type Cohort,
} from './AdminStatsShared'

type Totals = {
  accounts_count: number
  contacts_count: number

  requests_sent_total: number
  requests_sent_open: number
  requests_sent_overdue: number
  requests_sent_done: number
  requests_sent_archived: number
  requests_sent_avg_description: number | null

  requests_received_total: number
  requests_received_open: number
  requests_received_overdue: number
  requests_received_done: number
  requests_received_archived: number
  requests_received_avg_description: number | null

  todos_total: number
  todos_open: number
  todos_overdue: number
  todos_done: number
  todos_archived: number
  todos_avg_description: number | null

  dialog_total: number
  dialog_avg_description: number | null

  attachments_total: number
  attachments_avg_size_kb: number | null
}

type RosterRow = {
  account_id: string
  email: string
  contact_count: number
  requests_sent_total: number
  requests_received_total: number
  todos_total: number
  dialog_count: number
  attachments_count: number
  attachments_avg_size_kb: number | null
}

const NA = '—'

// Plain count — dash only for null/undefined (0 is a real value).
function n(v: number | null | undefined): string {
  return v === null || v === undefined ? NA : String(v)
}

// Whole-percent, rounded — dash when the denominator is 0 (nothing to be a
// percentage of), per spec §2.3.
function pct(count: number | null | undefined, total: number | null | undefined): string {
  if (!total) return NA
  return `${Math.round(((count ?? 0) / total) * 100)}%`
}

// "Average count per X" ratio (Volume table), one decimal place — spec
// §2.4 gives the formula but no rounding rule, so this follows the
// pre-existing avg_dialog_per_request precedent rather than inventing a
// whole-number convention the spec never asked for.
function ratio(count: number | null | undefined, total: number | null | undefined): string {
  if (!total) return NA
  return ((count ?? 0) / total).toFixed(1)
}

function kb(v: number | null | undefined): string {
  return v === null || v === undefined ? NA : `${v} KB`
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

  // Entities table (spec §2.3) — Avg Descr char's and the four status
  // percentages apply only to Req's Sent, Req's Received, and ToDos;
  // Accounts and Contacts show NA in every column but Count Total.
  function entitiesTable(t: Totals) {
    return (
      <div className="stattablewrap">
        <table className="stattable stattable-locked">
          <thead>
            <tr>
              <th></th>
              <th>Count Total</th>
              <th>Avg Descr char&apos;s</th>
              <th>Open</th>
              <th>Overdue</th>
              <th>Done</th>
              <th>Archived</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Accounts</td>
              <td>{n(t.accounts_count)}</td>
              <td>{NA}</td>
              <td>{NA}</td>
              <td>{NA}</td>
              <td>{NA}</td>
              <td>{NA}</td>
            </tr>
            <tr>
              <td>Contacts</td>
              <td>{n(t.contacts_count)}</td>
              <td>{NA}</td>
              <td>{NA}</td>
              <td>{NA}</td>
              <td>{NA}</td>
              <td>{NA}</td>
            </tr>
            <tr>
              <td>Req&apos;s Sent</td>
              <td>{n(t.requests_sent_total)}</td>
              <td>{n(t.requests_sent_avg_description)}</td>
              <td>{pct(t.requests_sent_open, t.requests_sent_total)}</td>
              <td>{pct(t.requests_sent_overdue, t.requests_sent_total)}</td>
              <td>{pct(t.requests_sent_done, t.requests_sent_total)}</td>
              <td>{pct(t.requests_sent_archived, t.requests_sent_total)}</td>
            </tr>
            <tr>
              <td>Req&apos;s Received</td>
              <td>{n(t.requests_received_total)}</td>
              <td>{n(t.requests_received_avg_description)}</td>
              <td>{pct(t.requests_received_open, t.requests_received_total)}</td>
              <td>{pct(t.requests_received_overdue, t.requests_received_total)}</td>
              <td>{pct(t.requests_received_done, t.requests_received_total)}</td>
              <td>{pct(t.requests_received_archived, t.requests_received_total)}</td>
            </tr>
            <tr>
              <td>ToDos</td>
              <td>{n(t.todos_total)}</td>
              <td>{n(t.todos_avg_description)}</td>
              <td>{pct(t.todos_open, t.todos_total)}</td>
              <td>{pct(t.todos_overdue, t.todos_total)}</td>
              <td>{pct(t.todos_done, t.todos_total)}</td>
              <td>{pct(t.todos_archived, t.todos_total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  // Volume table (spec §2.4) — Dialogs' Avg Descr is average character
  // length of Dialog text; Attachments' Avg Size is average file size in
  // KB. Both "Average count per" blocks divide the row's own Count Total
  // by each Entities-table Count Total (accounts/sent/received/todos),
  // per spec — not four separately-scoped subsets.
  function volumeTable(t: Totals) {
    return (
      <div className="stattablewrap">
        <table className="stattable stattable-locked">
          <thead>
            <tr>
              <th></th>
              <th>Count Total</th>
              <th>Avg Descr, Size</th>
              <th>per Account</th>
              <th>per Sent Req</th>
              <th>per Rec&apos;d Req</th>
              <th>per ToDo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Dialogs</td>
              <td>{n(t.dialog_total)}</td>
              <td>{n(t.dialog_avg_description)}</td>
              <td>{ratio(t.dialog_total, t.accounts_count)}</td>
              <td>{ratio(t.dialog_total, t.requests_sent_total)}</td>
              <td>{ratio(t.dialog_total, t.requests_received_total)}</td>
              <td>{ratio(t.dialog_total, t.todos_total)}</td>
            </tr>
            <tr>
              <td>Attachments</td>
              <td>{n(t.attachments_total)}</td>
              <td>{kb(t.attachments_avg_size_kb)}</td>
              <td>{ratio(t.attachments_total, t.accounts_count)}</td>
              <td>{ratio(t.attachments_total, t.requests_sent_total)}</td>
              <td>{ratio(t.attachments_total, t.requests_received_total)}</td>
              <td>{ratio(t.attachments_total, t.todos_total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  // Roster (spec §2.5) — simplified from the original build: Account is
  // shown as email (no display name), and the per-account Open/Overdue/
  // Done/Archived breakdown is dropped. That detail remains available by
  // switching the Accounts filter above to a specific account, which
  // re-scopes entitiesTable()/volumeTable() to that one account.
  function rosterTable() {
    return (
      <div className="stattablewrap">
        <table className="stattable stattable-locked">
          <thead>
            <tr>
              <th>Account</th>
              <th>Contacts</th>
              <th>Req Sent</th>
              <th>Req Rec&apos;d</th>
              <th>ToDos</th>
              <th>Dialogs</th>
              <th>Atch&apos;s</th>
              <th>Avg Atch Size</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.account_id}>
                <td>{r.email}</td>
                <td>{n(r.contact_count)}</td>
                <td>{n(r.requests_sent_total)}</td>
                <td>{n(r.requests_received_total)}</td>
                <td>{n(r.todos_total)}</td>
                <td>{n(r.dialog_count)}</td>
                <td>{n(r.attachments_count)}</td>
                <td>{kb(r.attachments_avg_size_kb)}</td>
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
              <div className="statsectionlabel">Entities</div>
              {entitiesTable(totals)}

              <div className="statsectionlabel">Volume</div>
              {volumeTable(totals)}

              <div className="statsectionlabel">Per-Account Roster</div>
              {rosterTable()}
            </>
          )}
        </div>
      </div>

      {totals && !needsProfile && (
        <div className="print-report">
          <div className="ptitle">Sum and Averages (as of {asOf})</div>
          <div className="statsectionlabel" style={{ margin: '10px 0' }}>Entities</div>
          {entitiesTable(totals)}
          <div className="statsectionlabel" style={{ margin: '14px 0 0' }}>Volume</div>
          {volumeTable(totals)}
          <div className="statsectionlabel" style={{ margin: '14px 0 0' }}>Per-Account Roster</div>
          {rosterTable()}
        </div>
      )}
    </div>
  )
}
