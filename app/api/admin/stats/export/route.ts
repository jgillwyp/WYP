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
 * Only 'contacts' is wired as of migration 056/Task 4 (2026-09-07) — the
 * plan's build order adds Requests/ToDos/Sum and Averages in the tasks
 * immediately following this one; each just needs its own case added to
 * ENTITY_CONFIG below; the response shape, auth, and workbook plumbing are
 * already entity-agnostic.
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
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const entity = url.searchParams.get('entity') ?? ''
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
