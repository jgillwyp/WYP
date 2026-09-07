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
 * granularity) built from TWO RPCs (grand totals + per-account roster),
 * exported as two sheets in one workbook rather than forced into the
 * single-RPC/single-sheet shape every other screen uses.
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
 * this is separate from ENTITY_CONFIG. Two sheets: Grand Totals (one row)
 * and Per-Account Roster (one row per cohort account), from
 * admin_stats_summary_totals()/admin_stats_summary_roster() (migration
 * 060) — the exact same two calls AdminSummaryStatsForm.tsx itself makes.
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

  const totalsSheet = workbook.addWorksheet('Grand Totals')
  totalsSheet.columns = [
    { header: 'Metric', key: 'metric', width: 26 },
    { header: 'Value', key: 'value', width: 16 },
  ]
  totalsSheet.getRow(1).font = { bold: true }
  const totalsLabels: Record<string, string> = {
    user_count: 'Accounts',
    requests_total: 'Requests total',
    dialog_total: 'Dialog total',
    avg_dialog_per_request: 'Avg Dialog / Request',
    avg_dialog_per_todo: 'Avg Dialog / ToDo',
    attachments_total_count: 'Attachments total count',
    attachments_total_size_kb: 'Attachments total size (KB)',
    avg_request_description_size: 'Avg Request Description (chars)',
    todos_total: 'ToDos total',
    avg_todo_description_size: 'Avg ToDo Description (chars)',
  }
  Object.entries(totalsLabels).forEach(([key, label]) => {
    totalsSheet.addRow({ metric: label, value: (totalsRow as Record<string, unknown>)[key] ?? null })
  })

  const rosterSheet = workbook.addWorksheet('Per-Account Roster')
  rosterSheet.columns = [
    { header: 'Account', key: 'email', width: 26 },
    { header: 'Display Name', key: 'display_name', width: 20 },
    { header: 'Contacts', key: 'contact_count', width: 10 },
    { header: 'Sent Total', key: 'requests_sent_total', width: 10 },
    { header: 'Sent Open', key: 'requests_sent_open', width: 10 },
    { header: 'Sent Overdue', key: 'requests_sent_overdue', width: 12 },
    { header: 'Sent Done', key: 'requests_sent_done', width: 10 },
    { header: 'Sent Archived', key: 'requests_sent_archived', width: 12 },
    { header: 'Received Total', key: 'requests_received_total', width: 12 },
    { header: 'Received Open', key: 'requests_received_open', width: 12 },
    { header: 'Received Overdue', key: 'requests_received_overdue', width: 14 },
    { header: 'Received Done', key: 'requests_received_done', width: 12 },
    { header: 'Received Archived', key: 'requests_received_archived', width: 14 },
    { header: 'Dialog', key: 'dialog_count', width: 10 },
    { header: 'Attachments', key: 'attachments_count', width: 12 },
    { header: 'Avg Size (KB)', key: 'attachments_avg_size_kb', width: 12 },
    { header: 'ToDos Total', key: 'todos_total', width: 10 },
    { header: 'ToDos Open', key: 'todos_open', width: 10 },
    { header: 'ToDos Done', key: 'todos_done', width: 10 },
    { header: 'ToDos Archived', key: 'todos_archived', width: 12 },
  ]
  rosterSheet.getRow(1).font = { bold: true }
  rosterRows.forEach((row) => rosterSheet.addRow(row))

  const buffer = await workbook.xlsx.writeBuffer()
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="wyp-sum-and-averages.xlsx"',
    },
  })
}
