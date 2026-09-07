'use client'

/**
 * Admin Statistics — shared filter bar, chart primitives, and small helpers
 * used by all four /admin/stats/* screens (Contacts, Requests, ToDos, Sum
 * and Averages). Built once against the Contacts Activity screen (the
 * simplest of the four — no Sent/Received split), then reused for the
 * other three per docs/WYP_Admin_Statistics_Plan.md's own build order.
 *
 * Chart treatment follows the plan's "Chart treatment" section literally:
 * hand-rolled inline SVG, no charting library, one hue per metric (a
 * sequential job, not more-is-darker), small multiples sharing one
 * horizontal period axis rather than one combo chart (the metrics live on
 * incompatible scales — counts vs. KB — and combining them would mean a
 * banned dual-axis chart). All of a screen's per-period rows are baked
 * into ONE <svg>, with a single non-scrolling label column beside it and
 * one shared overflow-x:auto wrapper around that one svg — the simplest
 * way to guarantee every row's bars share the same x-axis and scroll
 * perfectly in sync, since there is only one scrollable element to begin
 * with. Hover tooltips are native <title> elements on each bar/point —
 * dependency-free, and the underlying per-period table (StatTable below)
 * already satisfies "a table view exists" on its own, from the same
 * query, per the plan's own note that this isn't a separate build.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type Granularity = 'week' | 'month'
export type Cohort = 'all' | 'beta' | 'profile' | 'free' | 'subscriber'

export type ProfileOption = {
  id: string
  email: string
  display_name: string | null
}

// ---------------------------------------------------------------------------
// Date range helpers — <input type="month"> gives "YYYY-MM"; the RPCs take
// real dates, From = the 1st of that month, To = the last day of that month.
// ---------------------------------------------------------------------------

export function defaultFromMonth(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 2)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function defaultToMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthToFromDate(m: string): string {
  return `${m}-01`
}

export function monthToToDate(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const lastDay = new Date(y, mo, 0).getDate()
  return `${m}-${String(lastDay).padStart(2, '0')}`
}

export function formatPeriodLabel(periodStart: string, granularity: Granularity): string {
  const d = new Date(periodStart + 'T00:00:00')
  if (granularity === 'month') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Cohort — the shared All accounts / Beta allowlist / one specific profile
// filter every screen applies consistently (plan: "one filter dimension
// applied consistently, not a separate drill-down mode per screen").
// ---------------------------------------------------------------------------

export function useAdminProfiles() {
  const [profiles, setProfiles] = useState<ProfileOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase.rpc('admin_list_profiles')
      if (cancelled) return
      if (!error && Array.isArray(data)) {
        setProfiles(data as ProfileOption[])
      }
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { profiles, loading }
}

export function AdminStatsFilterBar(props: {
  fromMonth: string
  toMonth: string
  onFromMonth: (v: string) => void
  onToMonth: (v: string) => void
  granularity: Granularity
  onGranularity: (v: Granularity) => void
  cohort: Cohort
  onCohort: (v: Cohort) => void
  profileId: string
  onProfileId: (v: string) => void
  profiles: ProfileOption[]
  profilesLoading: boolean
  // Restricts which <option>s render in the Accounts select. Defaults to
  // the full five-value set every screen but Accounts uses; Accounts
  // passes ['all', 'beta'] -- 'profile' is degenerate for a "new accounts
  // per period" metric (always 1-or-0), and 'free'/'subscriber' would be
  // redundant with that screen's own New Free / New Subscribed columns.
  cohortOptions?: Cohort[]
}) {
  const {
    fromMonth, toMonth, onFromMonth, onToMonth,
    granularity, onGranularity,
    cohort, onCohort,
    profileId, onProfileId, profiles, profilesLoading,
    cohortOptions = ['all', 'beta', 'free', 'subscriber', 'profile'],
  } = props

  return (
    <div className="statfilters no-print">
      <div className="statfiltergroup">
        <label className="statfilterlabel" htmlFor="stat-from">From</label>
        <input
          id="stat-from"
          type="month"
          className="statfilterinput"
          value={fromMonth}
          max={toMonth}
          onChange={(e) => onFromMonth(e.target.value)}
        />
        <label className="statfilterlabel" htmlFor="stat-to">To</label>
        <input
          id="stat-to"
          type="month"
          className="statfilterinput"
          value={toMonth}
          min={fromMonth}
          onChange={(e) => onToMonth(e.target.value)}
        />
      </div>

      <div className="chips" role="tablist" aria-label="Granularity">
        <button
          type="button"
          className={`chip${granularity === 'week' ? ' sel' : ''}`}
          role="tab"
          aria-selected={granularity === 'week'}
          onClick={() => onGranularity('week')}
        >
          Weekly
        </button>
        <button
          type="button"
          className={`chip${granularity === 'month' ? ' sel' : ''}`}
          role="tab"
          aria-selected={granularity === 'month'}
          onClick={() => onGranularity('month')}
        >
          Monthly
        </button>
      </div>

      <div className="statfiltergroup">
        <label className="statfilterlabel" htmlFor="stat-cohort">Accounts</label>
        <select
          id="stat-cohort"
          className="statfilterinput"
          value={cohort}
          onChange={(e) => onCohort(e.target.value as Cohort)}
        >
          {cohortOptions.includes('all') && <option value="all">All accounts</option>}
          {cohortOptions.includes('beta') && <option value="beta">Beta allowlist</option>}
          {cohortOptions.includes('free') && <option value="free">Free accounts</option>}
          {cohortOptions.includes('subscriber') && <option value="subscriber">Subscribed accounts</option>}
          {cohortOptions.includes('profile') && <option value="profile">Specific account…</option>}
        </select>
        {cohort === 'profile' && cohortOptions.includes('profile') && (
          <select
            className="statfilterinput"
            value={profileId}
            onChange={(e) => onProfileId(e.target.value)}
            disabled={profilesLoading}
          >
            <option value="">{profilesLoading ? 'Loading…' : 'Choose an account'}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name ? `${p.display_name} — ${p.email}` : p.email}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chart primitives
// ---------------------------------------------------------------------------

const BAR_W = 34
const BAR_GAP = 10
const COL_W = BAR_W + BAR_GAP
const ROW_H = 64
const AXIS_H = 28
const LABEL_W = 128

export type BarRow = {
  key: string
  label: string
  color: string
  kind: 'bar'
  values: (number | null)[]
  unit?: string
}

export type DivergingRow = {
  key: string
  label: string
  plusColor: string
  minusColor: string
  kind: 'diverging'
  // signed net values: positive rendered up, negative rendered down
  values: (number | null)[]
}

export type LineRow = {
  key: string
  label: string
  color: string
  kind: 'line'
  values: (number | null)[]
  unit?: string
}

export type ChartRow = BarRow | DivergingRow | LineRow

function formatCellValue(v: number | null, unit?: string): string {
  if (v === null) return '—'
  const n = unit === 'KB' ? v.toFixed(1) : String(v)
  return unit ? `${n} ${unit}` : n
}

/**
 * One shared scrolling SVG for every row on a screen — see the file header
 * comment for why this, rather than one <svg> per row, is what keeps every
 * metric on the same x-axis and scrolling together.
 */
export function PeriodChartStack({
  periods,
  granularity,
  rows,
}: {
  periods: string[]
  granularity: Granularity
  rows: ChartRow[]
}) {
  const width = periods.length * COL_W + BAR_GAP
  const height = rows.length * ROW_H + AXIS_H

  return (
    <div className="statchartwrap">
      <div className="statlabels" style={{ width: LABEL_W }}>
        <div className="statlabelcell" style={{ height: AXIS_H }} />
        {rows.map((r) => (
          <div key={r.key} className="statlabelcell" style={{ height: ROW_H }}>
            {r.label}
          </div>
        ))}
      </div>
      <div className="statchartscroll">
        <svg width={width} height={height} role="img" aria-label="Period statistics chart">
          {/* Period axis labels along the top, one per column */}
          {periods.map((p, i) => (
            <text
              key={p}
              x={i * COL_W + BAR_GAP + BAR_W / 2}
              y={AXIS_H - 10}
              textAnchor="middle"
              fontSize="10"
              fill="var(--ink-soft, #5A6675)"
            >
              {formatPeriodLabel(p, granularity)}
            </text>
          ))}

          {rows.map((row, ri) => {
            const rowTop = AXIS_H + ri * ROW_H
            const rowBottom = rowTop + ROW_H

            if (row.kind === 'bar') {
              const max = Math.max(1, ...row.values.map((v) => v ?? 0))
              const trackH = ROW_H - 16
              return (
                <g key={row.key}>
                  <line x1={0} y1={rowBottom} x2={width} y2={rowBottom} stroke="var(--rule, #E2E6EC)" strokeWidth={1} />
                  {row.values.map((v, i) => {
                    const h = v === null ? 0 : Math.round((v / max) * trackH)
                    const x = i * COL_W + BAR_GAP
                    const y = rowBottom - 8 - h
                    return (
                      <rect key={i} x={x} y={y} width={BAR_W} height={Math.max(h, v ? 2 : 0)} rx={2} fill={row.color}>
                        <title>
                          {formatPeriodLabel(periods[i], granularity)}: {formatCellValue(v, row.unit)}
                        </title>
                      </rect>
                    )
                  })}
                </g>
              )
            }

            if (row.kind === 'diverging') {
              const maxAbs = Math.max(1, ...row.values.map((v) => Math.abs(v ?? 0)))
              const half = (ROW_H - 16) / 2
              const mid = rowTop + ROW_H / 2
              return (
                <g key={row.key}>
                  <line x1={0} y1={rowBottom} x2={width} y2={rowBottom} stroke="var(--rule, #E2E6EC)" strokeWidth={1} />
                  <line x1={0} y1={mid} x2={width} y2={mid} stroke="var(--rule, #E2E6EC)" strokeWidth={1} strokeDasharray="2,3" />
                  {row.values.map((v, i) => {
                    const val = v ?? 0
                    const h = Math.round((Math.abs(val) / maxAbs) * half)
                    const x = i * COL_W + BAR_GAP
                    const y = val >= 0 ? mid - h : mid
                    const fill = val >= 0 ? row.plusColor : row.minusColor
                    return (
                      <rect key={i} x={x} y={y} width={BAR_W} height={Math.max(h, v ? 2 : 0)} rx={2} fill={fill}>
                        <title>
                          {formatPeriodLabel(periods[i], granularity)}: {v === null ? '—' : (val >= 0 ? '+' : '') + val}
                        </title>
                      </rect>
                    )
                  })}
                </g>
              )
            }

            // line
            const max = Math.max(1, ...row.values.map((v) => v ?? 0))
            const trackH = ROW_H - 16
            const points = row.values.map((v, i) => {
              const x = i * COL_W + BAR_GAP + BAR_W / 2
              const y = v === null ? null : rowBottom - 8 - Math.round((v / max) * trackH)
              return { x, y, v }
            })
            const linePoints = points.filter((p) => p.y !== null).map((p) => `${p.x},${p.y}`).join(' ')
            return (
              <g key={row.key}>
                <line x1={0} y1={rowBottom} x2={width} y2={rowBottom} stroke="var(--rule, #E2E6EC)" strokeWidth={1} />
                <polyline points={linePoints} fill="none" stroke={row.color} strokeWidth={2} />
                {points.map((p, i) =>
                  p.y === null ? null : (
                    <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={row.color}>
                      <title>
                        {formatPeriodLabel(periods[i], granularity)}: {formatCellValue(p.v, row.unit)}
                      </title>
                    </circle>
                  )
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plain data table — the same rows/values the chart above renders, per the
// plan's own note that this is "the same query the charts render, not a
// separate build," and also the print/export source of truth.
// ---------------------------------------------------------------------------

export function StatTable({
  periods,
  granularity,
  rows,
}: {
  periods: string[]
  granularity: Granularity
  rows: ChartRow[]
}) {
  return (
    <div className="stattablewrap">
      <table className="stattable">
        <thead>
          <tr>
            <th>Period</th>
            {rows.map((r) => (
              <th key={r.key}>{r.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p, i) => (
            <tr key={p}>
              <td>{formatPeriodLabel(p, granularity)}</td>
              {rows.map((r) => (
                <td key={r.key}>
                  {formatCellValue(r.values[i], r.kind !== 'diverging' ? r.unit : undefined)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Print icon button — same inline-SVG icon already used on Request/ToDo
// Detail's own Print buttons (RequestDetailForm.tsx/TodoDetailForm.tsx),
// duplicated here per this codebase's own per-file convention rather than
// factoring out a one-line JSX snippet into a new shared icon component.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sum and Averages screen only — a point-in-time snapshot ("as of" a
// single date), not a per-period range, so it gets its own lighter filter
// bar rather than AdminStatsFilterBar's From/To/granularity trio. Defaults
// to today, a real date picker (not a month picker) since the exact day
// matters here — see docs/WYP_Admin_Statistics_Plan.md and migration 060's
// own comment on why Overdue is only ever computed when this equals today.
// ---------------------------------------------------------------------------

export function todayISODate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function AdminAsOfFilterBar(props: {
  asOf: string
  onAsOf: (v: string) => void
  cohort: Cohort
  onCohort: (v: Cohort) => void
  profileId: string
  onProfileId: (v: string) => void
  profiles: ProfileOption[]
  profilesLoading: boolean
}) {
  const { asOf, onAsOf, cohort, onCohort, profileId, onProfileId, profiles, profilesLoading } = props

  return (
    <div className="statfilters no-print">
      <div className="statfiltergroup">
        <label className="statfilterlabel" htmlFor="stat-asof">As of</label>
        <input
          id="stat-asof"
          type="date"
          className="statfilterinput"
          value={asOf}
          max={todayISODate()}
          onChange={(e) => onAsOf(e.target.value)}
        />
      </div>

      <div className="statfiltergroup">
        <label className="statfilterlabel" htmlFor="stat-cohort-asof">Accounts</label>
        <select
          id="stat-cohort-asof"
          className="statfilterinput"
          value={cohort}
          onChange={(e) => onCohort(e.target.value as Cohort)}
        >
          <option value="all">All accounts</option>
          <option value="beta">Beta allowlist</option>
          <option value="free">Free accounts</option>
          <option value="subscriber">Subscribed accounts</option>
          <option value="profile">Specific account…</option>
        </select>
        {cohort === 'profile' && (
          <select
            className="statfilterinput"
            value={profileId}
            onChange={(e) => onProfileId(e.target.value)}
            disabled={profilesLoading}
          >
            <option value="">{profilesLoading ? 'Loading…' : 'Choose an account'}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name ? `${p.display_name} — ${p.email}` : p.email}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI stat tile — Sum and Averages' Grand Totals row. A cumulative
// snapshot isn't a "this many happened in week X" figure, so it renders as
// a tile, not a bar (plan: "Sum and Averages' grand totals render as stat
// tiles, not bars").
// ---------------------------------------------------------------------------

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stattile">
      <div className="stattilevalue">{value}</div>
      <div className="stattilelabel">{label}</div>
      {sub && <div className="stattilesub">{sub}</div>}
    </div>
  )
}

export function PrintIconButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="iconbtn no-print" type="button" aria-label="Print" onClick={onClick} style={{ marginLeft: 'auto' }}>
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M7 8V3h10v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="4" y="8" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M7 14h10v7H7v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="17" cy="11" r="1" fill="currentColor" />
      </svg>
    </button>
  )
}
