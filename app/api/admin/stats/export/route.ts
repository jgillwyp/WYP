import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'

export const runtime = 'nodejs'

/**
 * GET /api/admin/stats/export?entity=contacts&from=...&to=...&granularity=
 * ...&cohort=...&profileId=... — requires an `Authorization: Bearer
 * <token>` header (a signed-in admin's own access token). One workbook per
 * screen, mirroring exactly whatever is currently on screen — the active
 * date range, granularity, and cohort filter — per docs/
 * WYP_Admin_Statistics_Plan.md's ".xlsx export" decision (2026-09-07): no
 * separate "full range regardless of filter" option.
 *
 * Calls the same admin_stats_* RPC the on-screen table itself calls (one
 * shared aggregation function per entity feeding the on-screen table, the
 * print view, and this export alike, per the plan) — never a separate
 * query, so the exported numbers can't drift from what's on screen. The
 * RPC re-checks is_admin itself; this route's own forwarded-JWT client has
 * no elevated privilege of its own, same posture as every other admin RPC
 * caller.
 *
 * entity=contacts|requests|todos all follow the ENTITY_CONFIG table below
 * (one RPC, one sheet, from/to/granularity/cohort params) — entity=summary
 * is handled as its own special case further down instead: Sum and
 * Averages is a point-in-time snapshot (asOf/cohort only, no from/
 * granularity) built from TWO RPCs (totals + per-account roster),
 * exported as three sheets — Entities, Volume, Per-Account Roster — in
 * one workbook rather than forced into the single-RPC/single-sheet shape
 * every other screen uses.
 */

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[WYP] Missing environment variable ${name}.`)
  return v
}

function getForwardedClient(authHeader: string) {
  return createClient(must('NEXT_PUBLIC_SUPABASE_URL'), must('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authHeader } },
  })
}

type ColumnDef = { header: string; key: string; width?: number }

const ENTITY_CONFIG: Record<
  string,
  { rpc: string; sheetName: string; columns: ColumnDef[] }
> = {
  accounts: {
    rpc: 'admin_stats_accounts',
    sheetName: 'Accounts Activity',
    columns: [
      { header: 'Period Start', key: 'period_start', width: 14 },
      { header: 'Period End', key: 'period_end', width: 14 },
      { header: 'New Free', key: 'new_free', width: 12 },
      { header: 'New Subscribed', key: 'new_subscribed', width: 14 },
      { header: 'Total', key: 'total', width: 10 },
    ],
  },
  contacts: {
    rpc: 'admin_stats_contacts',
    sheetName: 'Contacts Activity',
    columns: [
      { header: 'Period Start', key: 'period_start', width: 14 },
      { header: 'Period End', key: 'period_end', width: 14 },
      { header: 'Added', key: 'added', width: 10 },
      { header: 'Deleted', key: 'deleted', width: 10 },
      { header: 'With Phone', key: 'with_phone', width: 12 },
      { header: 'With Notes', key: 'with_notes', width: 12 },
      { header: 'Total', key: 'total', width: 10 },
    ],
  },
  requests: {
    rpc: 'admin_stats_requests',
    sheetName: 'Requests Activity',
    columns: [
      { header: 'Period Start', key: 'period_start', width: 14 },
      { header: 'Period End', key: 'period_end', width: 14 },
      { header: 'Sent Created', key: 'sent_created', width: 12 },
      { header: 'Received Created', key: 'received_created', width: 14 },
      { header: 'Sent Changed', key: 'sent_changed', width: 12 },
      { header: 'Received Changed', key: 'received_changed', width: 14 },
      { header: 'Sent Done', key: 'sent_done', width: 10 },
      { header: 'Received Done', key: 'received_done', width: 12 },
      { header: 'Deleted', key: 'deleted', width: 10 },
      { header: 'Archived', key: 'archived', width: 10 },
      { header: 'Unarchived', key: 'unarchived', width: 10 },
      { header: 'Sent Attachments', key: 'sent_attachments', width: 14 },
      { header: 'Received Attachments', key: 'received_attachments', width: 16 },
      { header: 'Sent Dialog', key: 'sent_dialog', width: 12 },
      { header: 'Received Dialog', key: 'received_dialog', width: 14 },
    ],
  },
  todos: {
    rpc: 'admin_stats_todos',
    sheetName: 'ToDos Activity',
    columns: [
      { header: 'Period Start', key: 'period_start', width: 14 },
      { header: 'Period End', key: 'period_end', width: 14 },
      { header: 'Created', key: 'created', width: 10 },
      { header: 'Changed', key: 'changed', width: 10 },
      { header: 'Done', key: 'done', width: 10 },
      { header: 'Deleted', key: 'deleted', width: 10 },
      { header: 'Archived', key: 'archived', width: 10 },
      { header: 'Unarchived', key: 'unarchived', width: 10 },
      { header: 'Attachments', key: 'attachments', width: 12 },
      { header: 'Dialog', key: 'dialog', width: 10 },
    ],
  },
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const entity = url.searchParams.get('entity') ?? ''

  if (entity === 'summary') {
    return exportSummary(request, url)
  }

  const config = ENTITY_CONFIG[entity]
  if (!config) {
    return Response.json({ error: 'unknown_entity' }, { status: 400 })
  }

  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const granularity = url.searchParams.get('granularity')
  const cohort = url.searchParams.get('cohort')
  const profileId = url.searchParams.get('profileId') || null
  if (!from || !to || !granularity || !cohort) {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const sb = getForwardedClient(authHeader)
  const { data: userData } = await sb.auth.getUser()
  if (!userData.user) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { data, error } = await sb.rpc(config.rpc, {
    p_from: from,
    p_to: to,
    p_granularity: granularity,
    p_cohort: cohort,
    p_profile_id: profileId,
  })

  if (error) {
    // The RPC itself raises 'Not authorized.' for a non-admin caller —
    // surfaced here as a plain 403 rather than a generic 500.
    const status = error.message?.includes('authorized') ? 403 : 500
    return Response.json({ error: 'query_failed', detail: error.message }, { status })
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Would You Please — Admin Statistics'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet(config.sheetName)
  sheet.columns = config.columns
  sheet.getRow(1).font = { bold: true }
  rows.forEach((row) => sheet.addRow(row))

  const buffer = await workbook.xlsx.writeBuffer()

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="wyp-${entity}-activity.xlsx"`,
    },
  })
}


/**
 * Sum and Averages export — see this file's own header comment for why
 * this is separate from ENTITY_CONFIG. Three sheets: Entities, Volume
 * (both one row per row-label — Accounts/Contacts/Req's Sent/Req's
 * Received/ToDos, and Dialogs/Attachments, respectively), and Per-Account
 * Roster (one row per cohort account), from
 * admin_stats_summary_totals()/admin_stats_summary_roster() (migration
 * 065) — the exact same two calls AdminSummaryStatsForm.tsx itself makes.
 * Percentages and "per X" ratios are computed here with the same
 * pct()/ratio() rules the component uses, so the exported figures match
 * the screen exactly.
 */
async function exportSummary(request: Request, url: URL): Promise<Response> {
  const asOf = url.searchParams.get('asOf')
  const cohort = url.searchParams.get('cohort')
  const profileId = url.searchParams.get('profileId') || null
  if (!asOf || !cohort) {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const sb = getForwardedClient(authHeader)
  const { data: userData } = await sb.auth.getUser()
  if (!userData.user) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const [totalsRes, rosterRes] = await Promise.all([
    sb.rpc('admin_stats_summary_totals', { p_asof: asOf, p_cohort: cohort, p_profile_id: profileId }),
    sb.rpc('admin_stats_summary_roster', { p_asof: asOf, p_cohort: cohort, p_profile_id: profileId }),
  ])

  if (totalsRes.error || rosterRes.error) {
    const message = totalsRes.error?.message ?? rosterRes.error?.message ?? 'query_failed'
    const status = message.includes('authorized') ? 403 : 500
    return Response.json({ error: 'query_failed', detail: message }, { status })
  }

  const totalsRow = (Array.isArray(totalsRes.data) ? totalsRes.data[0] : totalsRes.data) ?? {}
  const rosterRows = (rosterRes.data ?? []) as Array<Record<string, unknown>>

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Would You Please — Admin Statistics'
  workbook.created = new Date()

  // Percent/ratio helpers mirror AdminSummaryStatsForm.tsx's pct()/ratio()
  // exactly (migration 065) — the .xlsx must show the same numbers the
  // screen and its print view show, not a re-derivation of its own.
  const row = totalsRow as Record<string, number | null>
  const pct = (count: number | null | undefined, total: number | null | undefined) =>
    !total ? null : Math.round(((count ?? 0) / total) * 100) / 100 // fraction; format as % in Excel
  const ratio = (count: number | null | undefined, total: number | null | undefined) =>
    !total ? null : Math.round(((count ?? 0) / total) * 10) / 10

  const totalsSheet = workbook.addWorksheet('Entities')
  totalsSheet.columns = [
    { header: '', key: 'label', width: 16 },
    { header: 'Count Total', key: 'count', width: 12 },
    { header: "Avg Descr char's", key: 'avg_descr', width: 16 },
    { header: 'Open', key: 'open', width: 10 },
    { header: 'Overdue', key: 'overdue', width: 10 },
    { header: 'Done', key: 'done', width: 10 },
    { header: 'Archived', key: 'archived', width: 10 },
  ]
  totalsSheet.getRow(1).font = { bold: true }
  totalsSheet.addRow({ label: 'Accounts', count: row.accounts_count })
  totalsSheet.addRow({ label: 'Contacts', count: row.contacts_count })
  totalsSheet.addRow({
    label: "Req's Sent", count: row.requests_sent_total, avg_descr: row.requests_sent_avg_description,
    open: pct(row.requests_sent_open, row.requests_sent_total),
    overdue: pct(row.requests_sent_overdue, row.requests_sent_total),
    done: pct(row.requests_sent_done, row.requests_sent_total),
    archived: pct(row.requests_sent_archived, row.requests_sent_total),
  })
  totalsSheet.addRow({
    label: "Req's Received", count: row.requests_received_total, avg_descr: row.requests_received_avg_description,
    open: pct(row.requests_received_open, row.requests_received_total),
    overdue: pct(row.requests_received_overdue, row.requests_received_total),
    done: pct(row.requests_received_done, row.requests_received_total),
    archived: pct(row.requests_received_archived, row.requests_received_total),
  })
  totalsSheet.addRow({
    label: 'ToDos', count: row.todos_total, avg_descr: row.todos_avg_description,
    open: pct(row.todos_open, row.todos_total),
    overdue: pct(row.todos_overdue, row.todos_total),
    done: pct(row.todos_done, row.todos_total),
    archived: pct(row.todos_archived, row.todos_total),
  })
  for (let r = 3; r <= 6; r++) {
    ;['open', 'overdue', 'done', 'archived'].forEach((key) => {
      const cell = totalsSheet.getRow(r).getCell(key)
      if (cell.value !== null && cell.value !== undefined) cell.numFmt = '0%'
    })
  }

  const volumeSheet = workbook.addWorksheet('Volume')
  volumeSheet.columns = [
    { header: '', key: 'label', width: 14 },
    { header: 'Count Total', key: 'count', width: 12 },
    { header: 'Avg Descr, Size', key: 'avg', width: 16 },
    { header: 'per Account', key: 'per_account', width: 12 },
    { header: 'per Sent Req', key: 'per_sent', width: 12 },
    { header: "per Rec'd Req", key: 'per_received', width: 12 },
    { header: 'per ToDo', key: 'per_todo', width: 12 },
  ]
  volumeSheet.getRow(1).font = { bold: true }
  volumeSheet.addRow({
    label: 'Dialogs', count: row.dialog_total, avg: row.dialog_avg_description,
    per_account: ratio(row.dialog_total, row.accounts_count),
    per_sent: ratio(row.dialog_total, row.requests_sent_total),
    per_received: ratio(row.dialog_total, row.requests_received_total),
    per_todo: ratio(row.dialog_total, row.todos_total),
  })
  volumeSheet.addRow({
    label: 'Attachments', count: row.attachments_total, avg: row.attachments_avg_size_kb,
    per_account: ratio(row.attachments_total, row.accounts_count),
    per_sent: ratio(row.attachments_total, row.requests_sent_total),
    per_received: ratio(row.attachments_total, row.requests_received_total),
    per_todo: ratio(row.attachments_total, row.todos_total),
  })

  const rosterSheet = workbook.addWorksheet('Per-Account Roster')
  rosterSheet.columns = [
    { header: 'Account', key: 'email', width: 26 },
    { header: 'Contacts', key: 'contact_count', width: 10 },
    { header: 'Req Sent', key: 'requests_sent_total', width: 10 },
    { header: "Req Rec'd", key: 'requests_received_total', width: 10 },
    { header: 'ToDos', key: 'todos_total', width: 10 },
    { header: 'Dialogs', key: 'dialog_count', width: 10 },
    { header: "Atch's", key: 'attachments_count', width: 10 },
    { header: 'Avg Atch Size (KB)', key: 'attachments_avg_size_kb', width: 16 },
  ]
  rosterSheet.getRow(1).font = { bold: true }
  rosterRows.forEach((r) => rosterSheet.addRow(r))

  const buffer = await workbook.xlsx.writeBuffer()
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="wyp-sum-and-averages.xlsx"',
    },
  })
}
