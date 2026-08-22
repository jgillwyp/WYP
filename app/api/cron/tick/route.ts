import { randomUUID } from 'crypto'

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

import { buildIcsContent, type IcsRequestFields } from '@/lib/ics'
import { type RepeatRule, computeNextDueDate, shouldStopBeforeGenerating } from '@/lib/repeatRule'
import {
  EMAIL_FROM_ADDRESS,
  buildRequestEmailFromName,
  buildRequestEmailSubject,
  buildRequestEmailHtml,
  buildRequestEmailText,
  buildOverdueRecipientEmailSubject,
  buildOverdueRecipientEmailHtml,
  buildOverdueRecipientEmailText,
  buildTodoReminderEmailSubject,
  buildTodoReminderEmailHtml,
  buildTodoReminderEmailText,
  buildReminderDigestEmailSubject,
  buildReminderDigestEmailHtml,
  buildReminderDigestEmailText,
  buildOverdueDigestEmailSubject,
  buildOverdueDigestEmailHtml,
  buildOverdueDigestEmailText,
  type DigestItem,
} from '@/lib/email'
import { addDaysISO, hasLocalDateTimePassed, hoursSinceLocalDateTime, localDateISO, localHour } from '@/lib/cronTime'

// nodemailer needs Node's net/tls — see send-request/route.ts's identical
// comment.
export const runtime = 'nodejs'
// Vercel Pro allows up to 300s (owner upgraded 2026-08-17 specifically to
// unblock this route's hourly schedule) — 60s is a conservative starting
// budget for the app's current single-owner-testing scale; raise if a
// later run times out with real data volume.
export const maxDuration = 60

/**
 * GET/POST /api/cron/tick — the entire Chron notification system in one
 * route, invoked hourly by Vercel Cron (vercel.json). Owner's original
 * design pass, 2026-08-17 (see migration 032/033's header comments and the
 * decisions log): day-before Reminders (Sent Request Recipients, and ToDo/
 * Received-Request owners), a daily "just became Overdue" transition (an
 * individual notice to the Recipient, plus an un-gated digest to the
 * Requestor), and a recurring Overdue nudge to the Recipient (hourly-then-
 * daily for a Due-Time Request, daily-only for a Due-Date-only one) — plus
 * an opt-in "your Reminders just went out" digest to the Requestor.
 *
 * Single hourly invocation, not one cron schedule per job — Vercel Cron
 * entries are fixed to one UTC time each, but "morning" and "the morning
 * after" have to mean each OWNER's own local hour, not one fixed clock time
 * for every account. Running every hour and checking each candidate row's
 * own local hour (app/src/lib/cronTime.ts) correctly serves every time zone
 * from one schedule, at the cost of this route doing more branching per run
 * than three separate single-purpose routes would.
 *
 * service_role (SUPABASE_SERVICE_ROLE_KEY) is required and used throughout
 * — a cron run has no user session for RLS to scope to at all, unlike every
 * other route in this app. Same justified, narrow exception CLAUDE.md
 * already carves out for the attachments API routes (app/api/attachments),
 * extended here: this route legitimately needs to read and update rows
 * across every owner's account, which is exactly what a background job is
 * for.
 *
 * Idempotency: every phase reads and, on success only, writes one of
 * requests.reminder_sent_at / overdue_notified_at / last_overdue_nudge_at
 * (migration 032) — a send that fails (SMTP error, not-yet-configured) is
 * simply retried on the next hourly run rather than marked sent, matching
 * app/api/email/send-request/route.ts's own "never mark done unless it
 * really went out" posture.
 *
 * Manual test: `curl -X POST https://<host>/api/cron/tick -H "Authorization:
 * Bearer $CRON_SECRET"` — returns a per-phase count summary, never 500s on
 * a single row's failure (each row is wrapped so one bad email doesn't stop
 * the rest of the run).
 */

const MORNING_HOUR = 7 // local target hour for day-before Reminders (Requests + ToDos) and the Reminders-sent digest
const OVERDUE_HOUR = 0 // local target hour for the daily Overdue-transition pass ("12:01am the morning after") and recurring daily nudges

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

// Identical to send-request/route.ts's own helper — small enough, and this
// app's own convention (openPicker, formatMDY, ...) is to duplicate short
// per-file helpers rather than force a shared lib module for a few lines.
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
  reminder_digest_enabled: boolean
}

type ContactInfo = { email: string; display_name: string | null; time_zone: string | null } | null

// Phase E — Repeat generation (Jim's own recurrence-method design,
// 2026-08-21). Deliberately its own row shape/query, not a subset of
// requestRows/todoRows above: those two both filter `.is('done_date', null)`,
// but Jim's own instruction is that Due Date, never Done status, determines
// generation — a Done repeating Request/ToDo must still spawn its successor.
type RepeatRow = {
  id: string
  owner_id: string
  contact_id: string | null
  category_id: string | null
  description: string
  priority: number | null
  due_date: string
  due_time: string | null
  reminder_enabled: boolean
  overdue_reminder_enabled: boolean
  repeat_rule: RepeatRule
  repeat_occurrence_index: number | null
}

type CarryAttachmentRow = {
  id: string
  kind: 'file' | 'reference'
  file_name: string | null
  storage_path: string | null
  mime_type: string | null
  size_bytes: number | null
  reference_note: string | null
  reference_url: string | null
  uploaded_by: string | null
  uploaded_by_label: string | null
}

type RequestRow = {
  id: string
  owner_id: string
  contact_id: string | null
  description: string
  due_date: string | null
  due_time: string | null
  reminder_enabled: boolean
  reminder_sent_at: string | null
  overdue_reminder_enabled: boolean
  overdue_notified_at: string | null
  last_overdue_nudge_at: string | null
  contacts: ContactInfo
}

async function handle(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  if (!expected || authHeader !== expected) {
    return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }

  const transporter = getSmtpTransport()
  if (!transporter) {
    // Nothing useful can happen this run without SMTP — skip entirely
    // rather than touch any idempotency column, same as
    // send-request/route.ts's own not_configured no-op.
    return Response.json({ ok: true, reason: 'not_configured' }, { status: 200 })
  }

  const sb = getServiceRoleClient()
  const now = new Date()

  const counts = {
    requestReminders: 0,
    todoReminders: 0,
    overdueNotices: 0,
    overdueNudges: 0,
    reminderDigests: 0,
    overdueDigests: 0,
    repeatsGenerated: 0,
    errors: 0,
  }

  // --------------------------------------------------------------------
  // Load candidates: every non-Done, non-archived Request-with-Contact
  // that has a Due Date, and every non-Done, non-archived ToDo that has a
  // Due Date. One broad query per table — this app's current scale
  // (single-owner testing) doesn't need finer per-phase filtering at the
  // database level; each phase below applies its own eligibility check in
  // JS against these same rows.
  // --------------------------------------------------------------------
  const { data: reqData, error: reqError } = await sb
    .from('requests')
    .select(
      'id, owner_id, contact_id, description, due_date, due_time, reminder_enabled, reminder_sent_at, overdue_reminder_enabled, overdue_notified_at, last_overdue_nudge_at, contacts(email, display_name, time_zone)'
    )
    .not('contact_id', 'is', null)
    .is('done_date', null)
    .is('archived_at', null)
    .not('due_date', 'is', null)

  const { data: todoData, error: todoError } = await sb
    .from('requests')
    .select('id, owner_id, description, due_date, reminder_sent_at')
    .is('contact_id', null)
    .is('done_date', null)
    .is('archived_at', null)
    .not('due_date', 'is', null)

  if (reqError || todoError) {
    return Response.json(
      { ok: false, reason: 'query_failed', detail: (reqError ?? todoError)?.message },
      { status: 200 }
    )
  }

  const requestRows = (reqData ?? []) as unknown as RequestRow[]
  const todoRows = (todoData ?? []) as { id: string; owner_id: string; description: string; due_date: string; reminder_sent_at: string | null }[]

  // --------------------------------------------------------------------
  // Owner profiles, one batch query for every distinct owner touched.
  // requests.owner_id references auth.users(id) directly, not profiles —
  // no PostgREST embed is possible, same reason every other route in this
  // app fetches profiles as a separate query.
  // --------------------------------------------------------------------
  const ownerIds = Array.from(new Set([...requestRows.map((r) => r.owner_id), ...todoRows.map((r) => r.owner_id)]))
  const profileMap = new Map<string, ProfileRow>()
  if (ownerIds.length > 0) {
    const { data: profileData } = await sb
      .from('profiles')
      .select('id, display_name, time_zone, todo_dates_enabled, reminder_digest_enabled')
      .in('id', ownerIds)
    for (const p of (profileData ?? []) as ProfileRow[]) profileMap.set(p.id, p)
  }

  // Owner account email — only fetched lazily, per unique id, the first
  // time a phase actually needs one (ToDo Reminder recipient, digest
  // recipient, or Reply-To on a Recipient-facing email). GoTrue Admin API
  // (auth.admin.getUserById), same as this app's existing precedent for
  // reading an account's real login email server-side — see
  // get_contact_request_counts()'s own auth.users join for the SQL-side
  // equivalent.
  const ownerEmailCache = new Map<string, string | null>()
  async function getOwnerEmail(sbc: SupabaseClient, ownerId: string): Promise<string | null> {
    if (ownerEmailCache.has(ownerId)) return ownerEmailCache.get(ownerId) ?? null
    const { data } = await sbc.auth.admin.getUserById(ownerId)
    const email = data.user?.email ?? null
    ownerEmailCache.set(ownerId, email)
    return email
  }

  async function mintLink(sbc: SupabaseClient, requestId: string): Promise<string | null> {
    const { data, error } = await sbc.rpc('cron_issue_request_link', { p_request_id: requestId })
    if (error || !data) return null
    return `${siteUrl()}/r/${data}`
  }

  // Per-owner accumulators for the two Requestor digests — populated by
  // Phases A1/B below, sent once each near the end of this same run.
  const reminderDigestItems = new Map<string, DigestItem[]>()
  const overdueDigestItems = new Map<string, DigestItem[]>()
  function pushDigestItem(map: Map<string, DigestItem[]>, ownerId: string, item: DigestItem) {
    const list = map.get(ownerId) ?? []
    list.push(item)
    map.set(ownerId, list)
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
          ? [
              {
                filename: 'request.ics',
                content: opts.icsContent,
                contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
              },
            ]
          : undefined,
      })
      return true
    } catch {
      counts.errors += 1
      return false
    }
  }

  // ======================================================================
  // Phase A1 — Sent Request day-before Reminder, to the Recipient.
  // Timing: the Recipient's own local zone (contacts.time_zone, falling
  // back to the owner's own profiles.time_zone, same fallback chain
  // AddContactForm.tsx already uses) — this is the one recipient-facing
  // email whose timing is deliberately about the Recipient's own morning,
  // not the owner's, since the owner isn't the one reading it.
  // ======================================================================
  for (const row of requestRows) {
    if (!row.reminder_enabled || row.reminder_sent_at || !row.due_date || !row.contacts) continue
    const profile = profileMap.get(row.owner_id) ?? null
    const zone = row.contacts.time_zone ?? profile?.time_zone ?? null
    const tomorrow = addDaysISO(localDateISO(zone, now), 1)
    if (row.due_date !== tomorrow || localHour(zone, now) !== MORNING_HOUR) continue

    const link = await mintLink(sb, row.id)
    if (!link) {
      counts.errors += 1
      continue
    }
    const ownerEmail = await getOwnerEmail(sb, row.owner_id)
    const ownerName = profile?.display_name ?? null
    const bodyFields = { description: row.description, link, reminderPromised: false, siteUrl: siteUrl() }
    const icsFields: IcsRequestFields = {
      id: row.id,
      description: row.description,
      due_date: row.due_date,
      due_time: row.due_time,
      owner_name: ownerName,
    }

    const sent = await sendMail({
      to: row.contacts.email,
      subject: buildRequestEmailSubject('reminder', ownerName, row.due_date, row.due_time),
      html: buildRequestEmailHtml(bodyFields),
      text: buildRequestEmailText(bodyFields),
      fromName: buildRequestEmailFromName(ownerName),
      replyTo: ownerEmail,
      icsContent: buildIcsContent(icsFields, link, { reminderPromised: false }),
    })

    if (sent) {
      await sb.from('requests').update({ reminder_sent_at: now.toISOString() }).eq('id', row.id)
      counts.requestReminders += 1
      if (profile?.reminder_digest_enabled) {
        pushDigestItem(reminderDigestItems, row.owner_id, {
          recipientName: row.contacts.display_name ?? row.contacts.email,
          description: row.description,
          dueTime: row.due_time,
          link,
        })
      }
    }
  }

  // ======================================================================
  // Phase A2 — ToDo day-before Reminder, to the owner's own account email.
  // No Recipient, so no per-row Reminder checkbox either (migration 031's
  // reminder_enabled is a Request-only UI concept even though the column
  // is shared) — gated purely on the owner's own todo_dates_enabled
  // (owner: "Gated on ToDo Dates enabled"), timed to the OWNER's own zone.
  // ======================================================================
  for (const row of todoRows) {
    if (row.reminder_sent_at || !row.due_date) continue
    const profile = profileMap.get(row.owner_id) ?? null
    if (!profile?.todo_dates_enabled) continue
    const zone = profile.time_zone
    const tomorrow = addDaysISO(localDateISO(zone, now), 1)
    if (row.due_date !== tomorrow || localHour(zone, now) !== MORNING_HOUR) continue

    const ownerEmail = await getOwnerEmail(sb, row.owner_id)
    if (!ownerEmail) {
      counts.errors += 1
      continue
    }
    const fields = { description: row.description, dueDate: row.due_date, link: `${siteUrl()}/todos/${row.id}`, siteUrl: siteUrl() }
    const sent = await sendMail({
      to: ownerEmail,
      subject: buildTodoReminderEmailSubject(row.due_date),
      html: buildTodoReminderEmailHtml(fields),
      text: buildTodoReminderEmailText(fields),
      fromName: 'Would You Please',
      replyTo: null,
    })
    if (sent) {
      await sb.from('requests').update({ reminder_sent_at: now.toISOString() }).eq('id', row.id)
      counts.todoReminders += 1
    }
  }

  // ======================================================================
  // Phase B — Overdue transition (individual Recipient notice + un-gated
  // Requestor digest of newly-Overdue items). Timing: the OWNER's own
  // local zone — "12:01am the morning after" is naturally about whose day
  // just ended, i.e. the Requestor's, not the Recipient's.
  //
  // Gated on overdue_reminder_enabled (migration 037, "Daily thereafter"
  // checkbox, 2026-08-20) — confirmed with the owner: unchecking it stops
  // the Recipient's overdue emails ENTIRELY, including this first one, not
  // just the recurring nudges in Phase C below. When false, the transition
  // still advances (overdue_notified_at/last_overdue_nudge_at get set) so
  // Phase C's own state machine and idempotency stay correct if the toggle
  // is turned back on later — only the actual send and the Requestor digest
  // item are skipped. The Requestor's own un-gated digest is otherwise
  // unaffected by this toggle either way — that's the Requestor's own
  // visibility into their account, not the Recipient's to silence.
  // ======================================================================
  for (const row of requestRows) {
    if (row.overdue_notified_at || !row.due_date || !row.contacts) continue
    const profile = profileMap.get(row.owner_id) ?? null
    const zone = profile?.time_zone ?? null
    if (localHour(zone, now) !== OVERDUE_HOUR) continue
    if (!hasLocalDateTimePassed(zone, row.due_date, row.due_time, now)) continue

    if (!row.overdue_reminder_enabled) {
      const nowIso = now.toISOString()
      await sb
        .from('requests')
        .update({
          overdue_notified_at: nowIso,
          last_overdue_nudge_at: row.due_time ? row.last_overdue_nudge_at : nowIso,
        })
        .eq('id', row.id)
      continue
    }

    const link = await mintLink(sb, row.id)
    if (!link) {
      counts.errors += 1
      continue
    }
    const ownerEmail = await getOwnerEmail(sb, row.owner_id)
    const ownerName = profile?.display_name ?? null
    const fields = {
      ownerName,
      description: row.description,
      dueDate: row.due_date,
      dueTime: row.due_time,
      link,
      siteUrl: siteUrl(),
    }

    const sent = await sendMail({
      to: row.contacts.email,
      subject: buildOverdueRecipientEmailSubject(ownerName, row.due_date, row.due_time),
      html: buildOverdueRecipientEmailHtml(fields),
      text: buildOverdueRecipientEmailText(fields),
      fromName: buildRequestEmailFromName(ownerName),
      replyTo: ownerEmail,
    })

    if (sent) {
      const nowIso = now.toISOString()
      // A Due-Date-only Request's first nudge IS this same transition
      // event (migration 032's own header comment) — set
      // last_overdue_nudge_at here too so Phase C's daily-cadence branch
      // picks up from tomorrow, not tonight. A Due-Time Request's first
      // nudge is a separate, later event ("the hour after") — left null
      // for Phase C to set.
      await sb
        .from('requests')
        .update({
          overdue_notified_at: nowIso,
          last_overdue_nudge_at: row.due_time ? row.last_overdue_nudge_at : nowIso,
        })
        .eq('id', row.id)
      counts.overdueNotices += 1
      pushDigestItem(overdueDigestItems, row.owner_id, {
        recipientName: row.contacts.display_name ?? row.contacts.email,
        description: row.description,
        dueTime: row.due_time,
        link,
      })
    }
  }

  // ======================================================================
  // Phase C — Recurring Overdue nudges to the Recipient, for Requests
  // already past their one-time overdue_notified_at transition. Owner's
  // own cadence: "the hour after for Due Time Overdues, daily thereafter.
  // The next day and daily thereafter for Due Date only Requests" — the
  // Due-Date-only "next day" half is already covered by Phase B setting
  // last_overdue_nudge_at at the same moment as overdue_notified_at, so
  // every row reaching this phase (C2) just needs the recurring daily
  // check; only C1 (Due-Time's own first nudge) is genuinely hourly.
  // ======================================================================
  for (const row of requestRows) {
    if (!row.overdue_notified_at || !row.due_date || !row.contacts) continue
    if (!row.overdue_reminder_enabled) continue
    const profile = profileMap.get(row.owner_id) ?? null
    const zone = profile?.time_zone ?? null

    let shouldNudge = false
    if (row.due_time && !row.last_overdue_nudge_at) {
      // C1 — Due-Time Request's own first nudge, "the hour after."
      shouldNudge = hoursSinceLocalDateTime(zone, row.due_date, row.due_time, now) >= 1
    } else if (row.last_overdue_nudge_at) {
      // C2 — recurring daily cadence, both populations, gated to one
      // local calendar day apart so an hourly run doesn't re-fire on
      // every tick.
      const lastNudgeLocalDate = localDateISO(zone, new Date(row.last_overdue_nudge_at))
      shouldNudge = localHour(zone, now) === OVERDUE_HOUR && localDateISO(zone, now) > lastNudgeLocalDate
    }
    if (!shouldNudge) continue

    const link = await mintLink(sb, row.id)
    if (!link) {
      counts.errors += 1
      continue
    }
    const ownerEmail = await getOwnerEmail(sb, row.owner_id)
    const ownerName = profile?.display_name ?? null
    const fields = {
      ownerName,
      description: row.description,
      dueDate: row.due_date,
      dueTime: row.due_time,
      link,
      siteUrl: siteUrl(),
    }

    const sent = await sendMail({
      to: row.contacts.email,
      subject: buildOverdueRecipientEmailSubject(ownerName, row.due_date, row.due_time),
      html: buildOverdueRecipientEmailHtml(fields),
      text: buildOverdueRecipientEmailText(fields),
      fromName: buildRequestEmailFromName(ownerName),
      replyTo: ownerEmail,
    })

    if (sent) {
      await sb.from('requests').update({ last_overdue_nudge_at: now.toISOString() }).eq('id', row.id)
      counts.overdueNudges += 1
    }
  }

  // ======================================================================
  // Phase D — Requestor digests, sent once per owner for whatever Phases
  // A1/B accumulated this same run. Reminders-sent digest is opt-in
  // (profiles.reminder_digest_enabled, already filtered when items were
  // pushed in Phase A1); the new-Overdue digest is unconditional.
  // ======================================================================
  for (const [ownerId, items] of reminderDigestItems) {
    if (items.length === 0) continue
    const ownerEmail = await getOwnerEmail(sb, ownerId)
    if (!ownerEmail) continue
    const sent = await sendMail({
      to: ownerEmail,
      subject: buildReminderDigestEmailSubject(),
      html: buildReminderDigestEmailHtml(items, siteUrl()),
      text: buildReminderDigestEmailText(items),
      fromName: 'Would You Please',
      replyTo: null,
    })
    if (sent) counts.reminderDigests += 1
  }

  for (const [ownerId, items] of overdueDigestItems) {
    if (items.length === 0) continue
    const ownerEmail = await getOwnerEmail(sb, ownerId)
    if (!ownerEmail) continue
    const sent = await sendMail({
      to: ownerEmail,
      subject: buildOverdueDigestEmailSubject(),
      html: buildOverdueDigestEmailHtml(items, siteUrl()),
      text: buildOverdueDigestEmailText(items),
      fromName: 'Would You Please',
      replyTo: null,
    })
    if (sent) counts.overdueDigests += 1
  }

  // ======================================================================
  // Phase E — Repeat generation (Jim's own recurrence-method design,
  // 2026-08-21; migration 038). "The Due Date should be the determinant" —
  // fires once, at the OWNER's own local midnight, on the calendar day the
  // current occurrence's Due Date itself falls on (not the day after, which
  // is Phase B's own "became Overdue" moment) — independent of Done status,
  // so this deliberately does NOT reuse requestRows/todoRows above (both
  // filter out Done rows). repeat_next_generated_at (migration 038) is the
  // idempotency marker: set once a row's Due-Date-arrival has been
  // processed, whether or not a successor was actually produced (a stopped
  // series still needs to stop retrying every hour).
  // ======================================================================
  const { data: repeatData, error: repeatError } = await sb
    .from('requests')
    .select(
      'id, owner_id, contact_id, category_id, description, priority, due_date, due_time, reminder_enabled, overdue_reminder_enabled, repeat_rule, repeat_occurrence_index'
    )
    .not('repeat_rule', 'is', null)
    .is('archived_at', null)
    .is('repeat_next_generated_at', null)
    .not('due_date', 'is', null)

  const repeatRows = repeatError ? [] : ((repeatData ?? []) as unknown as RepeatRow[])

  const repeatOwnerIds = repeatRows.map((r) => r.owner_id).filter((id) => !profileMap.has(id))
  if (repeatOwnerIds.length > 0) {
    const { data: moreProfiles } = await sb
      .from('profiles')
      .select('id, display_name, time_zone, todo_dates_enabled, reminder_digest_enabled')
      .in('id', Array.from(new Set(repeatOwnerIds)))
    for (const p of (moreProfiles ?? []) as ProfileRow[]) profileMap.set(p.id, p)
  }

  for (const row of repeatRows) {
    const profile = profileMap.get(row.owner_id) ?? null
    const zone = profile?.time_zone ?? null
    if (localDateISO(zone, now) !== row.due_date || localHour(zone, now) !== OVERDUE_HOUR) continue

    const rule = row.repeat_rule
    const nextOccurrenceIndex = (row.repeat_occurrence_index ?? 1) + 1
    const nextDueDate = computeNextDueDate(row.due_date, rule)

    if (shouldStopBeforeGenerating(rule, nextOccurrenceIndex, nextDueDate)) {
      await sb.from('requests').update({ repeat_next_generated_at: now.toISOString() }).eq('id', row.id)
      continue
    }

    const { data: newRow, error: insertError } = await sb
      .from('requests')
      .insert({
        owner_id: row.owner_id,
        contact_id: row.contact_id,
        category_id: row.category_id,
        description: row.description,
        priority: row.priority,
        due_date: nextDueDate,
        due_time: row.due_time,
        reminder_enabled: row.reminder_enabled,
        overdue_reminder_enabled: row.overdue_reminder_enabled,
        repeat_rule: rule,
        repeat_occurrence_index: nextOccurrenceIndex,
      })
      .select('id')
      .single()

    if (insertError || !newRow) {
      counts.errors += 1
      continue
    }

    // Attachments/Locations carry-forward — Jim's own instruction ("Dialog
    // is not carried into repeated Requests. Select any Attachments that
    // should be included with each repeat.") — duplicates every row still
    // marked carry_into_repeats onto the new occurrence, keeping the same
    // flag true so it keeps propagating down the whole chain rather than
    // requiring the owner to re-select on every single generation.
    const { data: carryRows } = await sb
      .from('attachments')
      .select('id, kind, file_name, storage_path, mime_type, size_bytes, reference_note, reference_url, uploaded_by, uploaded_by_label')
      .eq('request_id', row.id)
      .eq('carry_into_repeats', true)
      .is('deleted_at', null)

    for (const att of (carryRows ?? []) as CarryAttachmentRow[]) {
      if (att.kind === 'file' && att.storage_path && att.file_name) {
        const newId = randomUUID()
        const newPath = `${newRow.id}/${newId}-${att.file_name}`
        const { error: copyError } = await sb.storage.from('attachments').copy(att.storage_path, newPath)
        if (copyError) {
          counts.errors += 1
          continue
        }
        await sb.from('attachments').insert({
          id: newId,
          request_id: newRow.id,
          uploaded_by: att.uploaded_by,
          uploaded_by_label: att.uploaded_by_label,
          kind: 'file',
          file_name: att.file_name,
          storage_path: newPath,
          size_bytes: att.size_bytes,
          mime_type: att.mime_type,
          carry_into_repeats: true,
        })
      } else if (att.kind === 'reference') {
        await sb.from('attachments').insert({
          request_id: newRow.id,
          uploaded_by: att.uploaded_by,
          uploaded_by_label: att.uploaded_by_label,
          kind: 'reference',
          reference_note: att.reference_note,
          reference_url: att.reference_url,
          carry_into_repeats: true,
        })
      }
    }

    await sb.from('requests').update({ repeat_next_generated_at: now.toISOString() }).eq('id', row.id)
    counts.repeatsGenerated += 1
  }

  return Response.json({ ok: true, counts }, { status: 200 })
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
