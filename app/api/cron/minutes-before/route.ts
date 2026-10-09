import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

import { buildIcsContent, type IcsRequestFields } from '@/lib/ics'
import {
  EMAIL_FROM_ADDRESS,
  buildRequestEmailFromName,
  buildMinutesBeforeEmailSubject,
  buildMinutesBeforeEmailHtml,
  buildMinutesBeforeEmailText,
  buildTodoMinutesBeforeEmailSubject,
  buildTodoMinutesBeforeEmailHtml,
  buildTodoMinutesBeforeEmailText,
} from '@/lib/email'
import { dueMomentUtc } from '@/lib/cronTime'

// nodemailer needs Node's net/tls — see app/api/cron/tick/route.ts's
// identical comment.
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET/POST /api/cron/minutes-before — the "Minutes before" Reminder, a
 * fourth, independent Reminders-until-Done option alongside the hourly
 * Day-before/Day-of/Day-after family in app/api/cron/tick/route.ts
 * (migration 077, 2026-10-09). Built as its own route on its own, more
 * frequent Vercel Cron schedule (vercel.json, every 5 minutes) rather than
 * folded into the hourly tick route — Jim's own example is a 10-minute
 * lead time for a phone call, which an hourly check could miss by up to 59
 * minutes.
 *
 * Backed by a small dedicated queue table, reminder_minutes_before_queue
 * (migration 077), rather than scanning every Request/ToDo on every 5-
 * minute tick: Jim's own suggestion, for processing efficiency. Each run
 * does two passes:
 *
 *   1. Sync — upsert a fresh fire_at for every currently-eligible,
 *      not-yet-sent row (reminder_minutes_before_enabled = true, Due Date
 *      AND Due Time both set — there's no exact moment to count back from
 *      with only a date — not Done, not archived, and for a ToTo,
 *      profiles.todo_dates_enabled on), then delete any queue row whose
 *      underlying Request/ToDo is no longer eligible (disabled, Done,
 *      archived, or Due Time cleared since the last sync). Recomputing
 *      fire_at on every sync, rather than only once at insert time, keeps
 *      it correct if Due Date/Time or the minutes value is edited, and is
 *      cheap: the eligibility WHERE clause is inherently narrow (only rows
 *      with this one checkbox on).
 *   2. Fire — select queue rows whose fire_at has arrived (`fire_at <=
 *      now()`), re-fetch each underlying row fresh, send, and on a
 *      successful send delete the queue row and stamp
 *      requests.reminder_minutes_before_sent_at (the same per-row
 *      idempotency-column convention every other Reminder type in this
 *      app already uses) — a failed send leaves the queue row in place to
 *      retry on the next 5-minute tick, same "never mark done unless it
 *      really went out" posture as the hourly route.
 *
 * Zone used to convert the naive due_date/due_time into an absolute fire_at
 * instant: for a Request, the Recipient's own zone (contacts.time_zone,
 * falling back to the owner's profiles.time_zone) — same reasoning as the
 * hourly route's own Recipient-facing phases (Day before/of/after), since
 * this notice is read by the Recipient, not the owner. For a ToDo, the
 * owner's own zone, matching that route's ToDo phases.
 *
 * Deliberately doesn't claim exact-minute phrasing ("due in 10 minutes") in
 * the email itself — an actual send can trail the configured fire_at by up
 * to this route's own 5-minute tick interval, so the wording states the
 * real Due Date/Time instead (see email.ts's minutesBeforeMessage).
 *
 * service_role required, same justified exception as the hourly route —
 * this job has no user session for RLS to scope to.
 *
 * Manual test: `curl -X POST https://<host>/api/cron/minutes-before -H
 * "Authorization: Bearer $CRON_SECRET"` — returns a sync/fire count
 * summary, never 500s on a single row's failure.
 */

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[WYP cron] Missing environment variable ${name}.`)
  return v
}

function getServiceRoleClient() {
  return createClient(must('NEXT_PUBLIC_SUPABASE_URL'), must('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

// Identical to tick/route.ts's own helper — this app's own convention is to
// duplicate short per-file helpers rather than force a shared lib module.
function getSmtpTransport() {
  const host = process.env.EMAIL_SMTP_HOST
  const port = Number(process.env.EMAIL_SMTP_PORT ?? '465')
  const user = process.env.EMAIL_SMTP_USER
  const pass = process.env.EMAIL_SMTP_PASSWORD
  if (!host || !user || !pass) return null

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wouldyouplease.com'
}

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

type ProfileRow = {
  id: string
  display_name: string | null
  time_zone: string | null
  todo_dates_enabled: boolean
  request_reminders_enabled: boolean
  todo_reminders_enabled: boolean
}

type ContactInfo = { email: string; display_name: string | null; time_zone: string | null } | null

type CandidateRow = {
  id: string
  owner_id: string
  contact_id: string | null
  description: string
  due_date: string | null
  due_time: string | null
  reminder_minutes_before_value: number | null
  receipt_confirmation_requested: boolean
  receipt_confirmed_at: string | null
  contacts: ContactInfo
}

const CANDIDATE_SELECT =
  'id, owner_id, contact_id, description, due_date, due_time, reminder_minutes_before_value, receipt_confirmation_requested, receipt_confirmed_at, contacts(email, display_name, time_zone)'

async function handle(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  if (!expected || authHeader !== expected) {
    return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }

  const transporter = getSmtpTransport()
  if (!transporter) {
    // Nothing useful can happen this run without SMTP — skip entirely,
    // same not_configured no-op as tick/route.ts.
    return Response.json({ ok: true, reason: 'not_configured' }, { status: 200 })
  }

  const sb = getServiceRoleClient()
  const now = new Date()

  const counts = {
    queued: 0,
    removed: 0,
    requestReminders: 0,
    todoReminders: 0,
    errors: 0,
  }

  // --------------------------------------------------------------------
  // Pass 1 — Sync. Load every currently-eligible, not-yet-sent Request
  // and ToDo row (reminder_minutes_before_enabled, Due Date AND Due Time
  // both set, not Done, not archived), compute each one's fire_at, and
  // upsert it into the queue. A ToDo additionally needs its owner's
  // todo_dates_enabled on — a ToDo's Due Time has no meaning without it,
  // same gate the hourly route's own ToDo phases use.
  // --------------------------------------------------------------------
  const { data: reqData, error: reqError } = await sb
    .from('requests')
    .select(CANDIDATE_SELECT)
    .not('contact_id', 'is', null)
    .is('done_date', null)
    .is('archived_at', null)
    .not('due_date', 'is', null)
    .not('due_time', 'is', null)
    .eq('reminder_minutes_before_enabled', true)
    .is('reminder_minutes_before_sent_at', null)

  const { data: todoData, error: todoError } = await sb
    .from('requests')
    .select(CANDIDATE_SELECT)
    .is('contact_id', null)
    .is('done_date', null)
    .is('archived_at', null)
    .not('due_date', 'is', null)
    .not('due_time', 'is', null)
    .eq('reminder_minutes_before_enabled', true)
    .is('reminder_minutes_before_sent_at', null)

  if (reqError || todoError) {
    return Response.json({ ok: false, reason: 'query_failed', detail: (reqError ?? todoError)?.message }, { status: 200 })
  }

  const requestRows = (reqData ?? []) as unknown as CandidateRow[]
  const todoRows = (todoData ?? []) as unknown as CandidateRow[]

  const ownerIds = Array.from(new Set([...requestRows.map((r) => r.owner_id), ...todoRows.map((r) => r.owner_id)]))
  const profileMap = new Map<string, ProfileRow>()
  if (ownerIds.length > 0) {
    const { data: profileData } = await sb
      .from('profiles')
      .select('id, display_name, time_zone, todo_dates_enabled, request_reminders_enabled, todo_reminders_enabled')
      .in('id', ownerIds)
    for (const p of (profileData ?? []) as ProfileRow[]) profileMap.set(p.id, p)
  }

  type QueueUpsert = { request_id: string; fire_at: string }
  const upserts: QueueUpsert[] = []
  const eligibleIds = new Set<string>()

  for (const row of requestRows) {
    if (!row.due_date || !row.due_time) continue
    const profile = profileMap.get(row.owner_id) ?? null
    const zone = row.contacts?.time_zone ?? profile?.time_zone ?? null
    const minutes = row.reminder_minutes_before_value ?? 0
    const fireAt = new Date(dueMomentUtc(zone, row.due_date, row.due_time, now).getTime() - minutes * 60_000)
    upserts.push({ request_id: row.id, fire_at: fireAt.toISOString() })
    eligibleIds.add(row.id)
  }

  for (const row of todoRows) {
    if (!row.due_date || !row.due_time) continue
    const profile = profileMap.get(row.owner_id) ?? null
    if (!profile?.todo_dates_enabled) continue
    const zone = profile.time_zone
    const minutes = row.reminder_minutes_before_value ?? 0
    const fireAt = new Date(dueMomentUtc(zone, row.due_date, row.due_time, now).getTime() - minutes * 60_000)
    upserts.push({ request_id: row.id, fire_at: fireAt.toISOString() })
    eligibleIds.add(row.id)
  }

  if (upserts.length > 0) {
    const { error: upsertError } = await sb.from('reminder_minutes_before_queue').upsert(upserts, { onConflict: 'request_id' })
    if (!upsertError) counts.queued = upserts.length
  }

  // Remove queue rows whose underlying Request/ToDo is no longer eligible
  // (checkbox turned off, marked Done/archived, Due Time cleared, or
  // already sent since the last sync pass).
  const { data: existingQueueRows } = await sb.from('reminder_minutes_before_queue').select('request_id')
  const staleIds = (existingQueueRows ?? []).map((r) => r.request_id as string).filter((id) => !eligibleIds.has(id))
  if (staleIds.length > 0) {
    await sb.from('reminder_minutes_before_queue').delete().in('request_id', staleIds)
    counts.removed = staleIds.length
  }

  // --------------------------------------------------------------------
  // Pass 2 — Fire. Whatever's due now, re-fetched fresh (not reused from
  // the sync pass above, in case this is a later tick with different
  // candidates already queued from an earlier run).
  // --------------------------------------------------------------------
  const { data: dueRows } = await sb
    .from('reminder_minutes_before_queue')
    .select('request_id')
    .is('sent_at', null)
    .lte('fire_at', now.toISOString())

  const dueIds = (dueRows ?? []).map((r) => r.request_id as string)
  if (dueIds.length === 0) {
    return Response.json({ ok: true, counts }, { status: 200 })
  }

  const { data: fireData } = await sb.from('requests').select(CANDIDATE_SELECT).in('id', dueIds)
  const fireRows = (fireData ?? []) as unknown as CandidateRow[]

  const fireOwnerIds = Array.from(new Set(fireRows.map((r) => r.owner_id)))
  const missingOwnerIds = fireOwnerIds.filter((id) => !profileMap.has(id))
  if (missingOwnerIds.length > 0) {
    const { data: moreProfiles } = await sb
      .from('profiles')
      .select('id, display_name, time_zone, todo_dates_enabled, request_reminders_enabled, todo_reminders_enabled')
      .in('id', missingOwnerIds)
    for (const p of (moreProfiles ?? []) as ProfileRow[]) profileMap.set(p.id, p)
  }

  const ownerEmailCache = new Map<string, string | null>()
  async function getOwnerEmail(sbc: SupabaseClient, ownerId: string): Promise<string | null> {
    if (ownerEmailCache.has(ownerId)) return ownerEmailCache.get(ownerId) ?? null
    const { data } = await sbc.auth.admin.getUserById(ownerId)
    const email = data.user?.email ?? null
    ownerEmailCache.set(ownerId, email)
    return email
  }

  const recipientAccountStatusCache = new Map<string, 'none' | 'free' | 'subscriber'>()
  async function getRecipientAccountStatus(sbc: SupabaseClient, email: string): Promise<'none' | 'free' | 'subscriber'> {
    const key = email.toLowerCase()
    if (recipientAccountStatusCache.has(key)) return recipientAccountStatusCache.get(key)!
    const { data } = await sbc.rpc('get_account_status_by_email', { p_email: email })
    const status: 'none' | 'free' | 'subscriber' = data === 'free' || data === 'subscriber' ? data : 'none'
    recipientAccountStatusCache.set(key, status)
    return status
  }

  async function mintLink(sbc: SupabaseClient, requestId: string): Promise<string | null> {
    const { data, error } = await sbc.rpc('cron_issue_request_link', { p_request_id: requestId })
    if (error || !data) return null
    return `${siteUrl()}/r/${data}`
  }

  async function sendMail(opts: {
    to: string
    subject: string
    html: string
    text: string
    fromName: string
    replyTo: string | null
    icsContent?: string
  }): Promise<boolean> {
    try {
      await transporter!.sendMail({
        from: `"${opts.fromName}" <${EMAIL_FROM_ADDRESS}>`,
        to: opts.to,
        replyTo: opts.replyTo ?? undefined,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        attachments: opts.icsContent
          ? [{ filename: 'request.ics', content: opts.icsContent, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }]
          : undefined,
      })
      return true
    } catch {
      counts.errors += 1
      return false
    }
  }

  for (const row of fireRows) {
    if (!row.due_date || !row.due_time) continue
    const profile = profileMap.get(row.owner_id) ?? null
    const minutes = row.reminder_minutes_before_value ?? 0

    if (row.contact_id && row.contacts) {
      // Request — sent to the Recipient.
      const link = await mintLink(sb, row.id)
      if (!link) {
        counts.errors += 1
        continue
      }
      const ownerEmail = await getOwnerEmail(sb, row.owner_id)
      const ownerName = profile?.display_name ?? null
      const recipientAccountStatus = await getRecipientAccountStatus(sb, row.contacts.email)
      const fields = {
        description: row.description,
        dueDate: row.due_date,
        dueTime: row.due_time,
        minutesBefore: minutes,
        link,
        siteUrl: siteUrl(),
        ownerName,
        recipientAccountStatus,
        remindersShown: profile?.request_reminders_enabled ?? false,
      }
      const icsFields: IcsRequestFields = {
        id: row.id,
        description: row.description,
        due_date: row.due_date,
        due_time: row.due_time,
        owner_name: ownerName,
      }
      const sent = await sendMail({
        to: row.contacts.email,
        subject: buildMinutesBeforeEmailSubject(ownerName, row.due_date, row.due_time),
        html: buildMinutesBeforeEmailHtml(fields),
        text: buildMinutesBeforeEmailText(fields),
        fromName: buildRequestEmailFromName(ownerName),
        replyTo: ownerEmail,
        icsContent: buildIcsContent(icsFields, link),
      })
      if (sent) {
        await sb.from('requests').update({ reminder_minutes_before_sent_at: now.toISOString() }).eq('id', row.id)
        // Marks the queue row sent rather than deleting it immediately —
        // the next sync pass's own cleanup step removes it once
        // requests.reminder_minutes_before_sent_at (just set above) makes
        // this row fail the eligibility query, matching migration 077's
        // own "sent rows accumulate briefly, then get swept" comment on
        // its partial index.
        await sb.from('reminder_minutes_before_queue').update({ sent_at: now.toISOString() }).eq('request_id', row.id)
        counts.requestReminders += 1
      }
    } else {
      // ToDo — sent to the owner's own account email, no Recipient.
      const ownerEmail = await getOwnerEmail(sb, row.owner_id)
      if (!ownerEmail) {
        counts.errors += 1
        continue
      }
      const fields = {
        description: row.description,
        dueDate: row.due_date,
        dueTime: row.due_time,
        minutesBefore: minutes,
        link: `${siteUrl()}/todos/${row.id}`,
        siteUrl: siteUrl(),
        remindersShown: profile?.todo_reminders_enabled ?? false,
      }
      const sent = await sendMail({
        to: ownerEmail,
        subject: buildTodoMinutesBeforeEmailSubject(row.due_date, row.due_time),
        html: buildTodoMinutesBeforeEmailHtml(fields),
        text: buildTodoMinutesBeforeEmailText(fields),
        fromName: 'Would You Please',
        replyTo: null,
      })
      if (sent) {
        await sb.from('requests').update({ reminder_minutes_before_sent_at: now.toISOString() }).eq('id', row.id)
        await sb.from('reminder_minutes_before_queue').update({ sent_at: now.toISOString() }).eq('request_id', row.id)
        counts.todoReminders += 1
      }
    }
  }

  return Response.json({ ok: true, counts }, { status: 200 })
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
