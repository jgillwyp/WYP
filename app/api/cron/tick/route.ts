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
  buildTodoOverdueEmailSubject,
  buildTodoOverdueEmailHtml,
  buildTodoOverdueEmailText,
  buildTodoDayOfEmailSubject,
  buildTodoDayOfEmailHtml,
  buildTodoDayOfEmailText,
  buildReminderDigestEmailSubject,
  buildReminderDigestEmailHtml,
  buildReminderDigestEmailText,
  buildOverdueDigestEmailSubject,
  buildOverdueDigestEmailHtml,
  buildOverdueDigestEmailText,
  type DigestItem,
} from '@/lib/email'
import { addDaysISO, hasLocalDateTimePassed, localDateISO, localHour } from '@/lib/cronTime'

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
 * decisions log), since simplified, 2026-08-22 — see the "Day after"
 * paragraph below: Reminders-until-Done for both Requests and ToDos, each
 * with three independent, one-time checkboxes — "Day before" (Requests:
 * Phase A1; ToDos: Phase A2), "Day of" (Phase A1b/A2b), and "Day after"
 * (Phase B for Requests, Phase A3 for ToDos) — plus two opt-in/un-gated
 * digests to the Requestor (Phase D) and Repeat generation (Phase E).
 * Migration 044 (2026-08-23) originally AND-gated Phase A1/A1b/B on the
 * owner's own profiles.request_reminders_enabled ("Show Reminders" in
 * Account's Request Options section), mirroring todo_reminders_enabled's
 * own Phase A2/A2b/A3 gate. Both gates were REMOVED 2026-08-25, per Jim's
 * own rewritten Show Reminders wording ("Without regard to whether
 * Reminders are shown, Reminders are sent as indicated with Default...
 * settings"): Show Reminders is now a pure UI-visibility toggle for the
 * Reminders-until-Done banner only — actual sending here depends solely on
 * each row's own reminder_enabled/reminder_day_of_enabled/
 * overdue_reminder_enabled columns, which are populated from the owner's
 * Default settings at creation regardless of whether the banner was ever
 * shown. todo_dates_enabled is still checked on the ToDo phases below —
 * that one gates on data availability (a ToDo's Due Date column), not on
 * banner visibility, so it stays.
 *
 * Single hourly invocation, not one cron schedule per job — Vercel Cron
 * entries are fixed to one UTC time each, but "morning" and "the day after"
 * have to mean each recipient's own local hour, not one fixed clock time
 * for every account. Running every hour and checking each candidate row's
 * own local hour (app/src/lib/cronTime.ts) correctly serves every time zone
 * from one schedule, at the cost of this route doing more branching per run
 * than several separate single-purpose routes would. The owner has said he
 * expects other cron-based features later — possibly even system-
 * management ones — so this hourly scaffolding is kept intact even as
 * individual phases below are rewritten or simplified; only the Phase
 * bodies change, never the single-invocation structure itself.
 *
 * "Day after" simplification (2026-08-22) — the owner found the original
 * "Daily thereafter" open-ended recurring Overdue-nudge design (old Phase
 * B/C for Requests, old Phase A3 for ToDos: an individual notice the moment
 * a Due Date lapsed, then an hourly-then-daily or daily-only nudge forever
 * after) too likely to trigger spam complaints, with no way to know for
 * sure. Replaced outright by a single, one-time "Day after" send — the
 * calendar day following Due Date, never repeating — sharing the exact same
 * three-checkbox shape as "Day before"/"Day of" and now available on ToDos
 * too (sent to the owner's own account email, since a ToDo has no
 * Recipient), not just Requests. overdue_reminder_enabled/
 * overdue_notified_at (migration 037/032) are reused in place, not renamed
 * — same "UI label change never means a DB rename" precedent this app has
 * followed throughout (see migration 043's own header comment).
 * last_overdue_nudge_at (migration 032) is now unused by this route — left
 * in the schema rather than dropped, per the owner's own instruction not to
 * remove the underlying cron structure.
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
 * requests.reminder_sent_at / reminder_day_of_sent_at / overdue_notified_at
 * (migration 032/042) — a send that fails (SMTP error, not-yet-configured)
 * is simply retried on the next hourly run rather than marked sent,
 * matching app/api/email/send-request/route.ts's own "never mark done
 * unless it really went out" posture. Each of the three Reminder types is a
 * true one-shot: once its own eligibility window (a specific calendar day,
 * at the target local hour) has passed uncaptured, it does not retroactively
 * fire later — turning a checkbox on after its own day has passed produces
 * no catch-up send, by design, same as "Day of" already worked before this
 * batch.
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
  // request_reminders_enabled / todo_reminders_enabled (migrations 041/044)
  // are no longer read here — as of 2026-08-25 they're pure UI-visibility
  // toggles (Account Options' "Show Reminders"), not sending gates. See
  // this file's header comment.
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
  // "Day of" (migration 042, 2026-08-22) — independent third Reminders-
  // until-Done checkbox, own idempotency marker, no lead-time floor.
  reminder_day_of_enabled: boolean
  reminder_day_of_sent_at: string | null
  // "Day after" (renamed from "Daily thereafter," migration 043,
  // 2026-08-22 — column unchanged, meaning simplified from a recurring
  // cron nudge to a single one-time send). overdue_notified_at is now this
  // checkbox's own idempotency marker; last_overdue_nudge_at (migration
  // 032) is no longer read or written by this route — left in the schema
  // per the owner's own instruction not to drop the underlying cron
  // structure, but this route has nothing left to use it for.
  overdue_reminder_enabled: boolean
  overdue_notified_at: string | null
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
    requestDayOfReminders: 0,
    todoReminders: 0,
    todoDayOfReminders: 0,
    // "Day after" simplification, 2026-08-22 — replaces the old four-way
    // notice/nudge split (overdueNotices/overdueNudges/todoOverdueNotices/
    // todoOverdueNudges) with two counters, one per one-time send.
    requestDayAfterReminders: 0,
    todoDayAfterReminders: 0,
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
      'id, owner_id, contact_id, description, due_date, due_time, reminder_enabled, reminder_sent_at, reminder_day_of_enabled, reminder_day_of_sent_at, overdue_reminder_enabled, overdue_notified_at, contacts(email, display_name, time_zone)'
    )
    .not('contact_id', 'is', null)
    .is('done_date', null)
    .is('archived_at', null)
    .not('due_date', 'is', null)

  const { data: todoData, error: todoError } = await sb
    .from('requests')
    .select(
      'id, owner_id, description, due_date, reminder_enabled, reminder_sent_at, reminder_day_of_enabled, reminder_day_of_sent_at, overdue_reminder_enabled, overdue_notified_at'
    )
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
  const todoRows = (todoData ?? []) as {
    id: string
    owner_id: string
    description: string
    due_date: string
    reminder_enabled: boolean
    reminder_sent_at: string | null
    reminder_day_of_enabled: boolean
    reminder_day_of_sent_at: string | null
    overdue_reminder_enabled: boolean
    overdue_notified_at: string | null
  }[]

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
      .select(
        'id, display_name, time_zone, todo_dates_enabled, reminder_digest_enabled'
      )
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
    const bodyFields = {
      description: row.description,
      link,
      // reminderSchedule omitted (2026-08-22, second same-day follow-up) —
      // a Reminder email doesn't restate the full Reminders-until-Done
      // schedule inside itself; only the Initial Request email
      // (send-request/route.ts) does that.
      siteUrl: siteUrl(),
      dueDate: row.due_date,
      dueTime: row.due_time,
      ownerName,
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
      subject: buildRequestEmailSubject('reminder', ownerName, row.due_date, row.due_time),
      html: buildRequestEmailHtml(bodyFields),
      text: buildRequestEmailText(bodyFields),
      fromName: buildRequestEmailFromName(ownerName),
      replyTo: ownerEmail,
      icsContent: buildIcsContent(icsFields, link),
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
  // Phase A1b — Sent Request "Day of" Reminder, to the Recipient. New
  // 2026-08-22 (migration 042) — a fully independent third Reminders-
  // until-Done checkbox alongside "Day before"/A1 above and "Daily
  // thereafter"/Phase B-C. Deliberately NOT linked to the Overdue
  // machinery below, even though Jim's own original request raised the
  // question of a connection ("This would also apply to the overdue
  // notice related to a lapsed Due Time... Reminder/Overdue are close in
  // meaning") — that question was never resolved before he stepped away,
  // so this phase is scoped narrowly: it only ever sends once, gated on
  // reminder_day_of_enabled/reminder_day_of_sent_at, the same day the
  // Request is due, and never touches overdue_notified_at/
  // last_overdue_nudge_at or Phase B/C's own eligibility. Revisit once
  // Jim clarifies the intended relationship. No lead-time floor (unlike
  // isReminderEligible's 3-day minimum for Day-before) — same-day is the
  // entire point of this checkbox, so there is nothing to be "too close"
  // to. Same Recipient-zone timing as Phase A1, same reused
  // buildRequestEmailSubject/Html/Text (day-before and day-of share one
  // body template, differing only in the subject line's "DUE TODAY:"
  // prefix — reminderSchedule is omitted either way, since it only ever
  // governs the Initial email's own schedule sentence).
  // Deliberately NOT added to the opt-in "Reminders sent" digest — that
  // digest's own fixed wording ("A day-before Reminder email was just
  // sent...") would misdescribe a same-day send; left out rather than
  // reworded until Jim confirms he wants Day-of included there too.
  // ======================================================================
  for (const row of requestRows) {
    if (!row.reminder_day_of_enabled || row.reminder_day_of_sent_at || !row.due_date || !row.contacts) continue
    const profile = profileMap.get(row.owner_id) ?? null
    const zone = row.contacts.time_zone ?? profile?.time_zone ?? null
    if (row.due_date !== localDateISO(zone, now) || localHour(zone, now) !== MORNING_HOUR) continue

    const link = await mintLink(sb, row.id)
    if (!link) {
      counts.errors += 1
      continue
    }
    const ownerEmail = await getOwnerEmail(sb, row.owner_id)
    const ownerName = profile?.display_name ?? null
    const bodyFields = {
      description: row.description,
      link,
      // reminderSchedule omitted (2026-08-22, second same-day follow-up) —
      // a Reminder email doesn't restate the full Reminders-until-Done
      // schedule inside itself; only the Initial Request email
      // (send-request/route.ts) does that.
      siteUrl: siteUrl(),
      dueDate: row.due_date,
      dueTime: row.due_time,
      ownerName,
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
      subject: buildRequestEmailSubject('reminder_day_of', ownerName, row.due_date, row.due_time),
      html: buildRequestEmailHtml(bodyFields),
      text: buildRequestEmailText(bodyFields),
      fromName: buildRequestEmailFromName(ownerName),
      replyTo: ownerEmail,
      icsContent: buildIcsContent(icsFields, link),
    })

    if (sent) {
      await sb.from('requests').update({ reminder_day_of_sent_at: now.toISOString() }).eq('id', row.id)
      counts.requestDayOfReminders += 1
    }
  }

  // ======================================================================
  // Phase A2 — ToDo day-before Reminder, to the owner's own account email.
  // No Recipient, so no per-row "who to notify" question. Gated only on
  // todo_dates_enabled — a ToDo's Due Date column has no meaning without
  // it, so a row can't have due_date set at all if it's off — not on
  // todo_reminders_enabled (2026-08-25: Show Reminders is now a pure
  // UI-visibility toggle for the banner, per Jim's own rewritten wording,
  // "Without regard to whether Reminders are shown..."). Actual sending
  // depends solely on the row's own reminder_enabled ("Day before")
  // checkbox. Timed to the OWNER's own zone.
  // ======================================================================
  for (const row of todoRows) {
    if (row.reminder_sent_at || !row.due_date || !row.reminder_enabled) continue
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
  // Phase A2b — ToDo "Day of" Reminder, to the owner's own account email.
  // New 2026-08-22 (migration 042), mirrors Phase A1b's own independence
  // from the Overdue machinery — a fully separate third checkbox from
  // Phase A2's day-before Reminder above, own idempotency marker
  // (reminder_day_of_sent_at), no lead-time floor (fires the very morning
  // the ToDo is due). Same gating shape as Phase A2 (2026-08-25): only
  // profile.todo_dates_enabled, plus the row's own reminder_day_of_enabled
  // — not todo_reminders_enabled, see Phase A2's own comment above. Timed
  // to the OWNER's own zone, same as Phase A2 and A3.
  // ======================================================================
  for (const row of todoRows) {
    if (row.reminder_day_of_sent_at || !row.due_date || !row.reminder_day_of_enabled) continue
    const profile = profileMap.get(row.owner_id) ?? null
    if (!profile?.todo_dates_enabled) continue
    const zone = profile.time_zone
    if (row.due_date !== localDateISO(zone, now) || localHour(zone, now) !== MORNING_HOUR) continue

    const ownerEmail = await getOwnerEmail(sb, row.owner_id)
    if (!ownerEmail) {
      counts.errors += 1
      continue
    }
    const fields = { description: row.description, dueDate: row.due_date, link: `${siteUrl()}/todos/${row.id}`, siteUrl: siteUrl() }
    const sent = await sendMail({
      to: ownerEmail,
      subject: buildTodoDayOfEmailSubject(row.due_date),
      html: buildTodoDayOfEmailHtml(fields),
      text: buildTodoDayOfEmailText(fields),
      fromName: 'Would You Please',
      replyTo: null,
    })
    if (sent) {
      await sb.from('requests').update({ reminder_day_of_sent_at: now.toISOString() }).eq('id', row.id)
      counts.todoDayOfReminders += 1
    }
  }

  // ======================================================================
  // Phase A3 — ToDo "Day after" notice, to the owner's own account email.
  // Single one-time send on the calendar day after Due Date, at
  // OVERDUE_HOUR — replaces the old open-ended recurring-Overdue-nudge
  // design entirely, per the owner's own 2026-08-22 spam-complaint
  // concern (see this file's header comment). overdue_notified_at is the
  // idempotency marker; a checkbox turned on after its own day-after date
  // has already passed produces no catch-up send, same as "Day of."
  // Gated on profile.todo_dates_enabled (data-availability, not
  // visibility — see Phase A2's comment above) and the row's own
  // overdue_reminder_enabled ("Day after" checkbox) — not
  // todo_reminders_enabled (2026-08-25). No separate Recipient whose own
  // visibility is independent of the owner's checkbox here, it's the same
  // person either way.
  // ======================================================================
  for (const row of todoRows) {
    if (row.overdue_notified_at || !row.due_date || !row.overdue_reminder_enabled) continue
    const profile = profileMap.get(row.owner_id) ?? null
    if (!profile?.todo_dates_enabled) continue
    const zone = profile.time_zone
    if (localHour(zone, now) !== OVERDUE_HOUR) continue
    if (localDateISO(zone, now) <= row.due_date) continue

    const ownerEmail = await getOwnerEmail(sb, row.owner_id)
    if (!ownerEmail) {
      counts.errors += 1
      continue
    }
    const fields = { description: row.description, dueDate: row.due_date, link: `${siteUrl()}/todos/${row.id}`, siteUrl: siteUrl() }
    const sent = await sendMail({
      to: ownerEmail,
      subject: buildTodoOverdueEmailSubject(row.due_date),
      html: buildTodoOverdueEmailHtml(fields),
      text: buildTodoOverdueEmailText(fields),
      fromName: 'Would You Please',
      replyTo: null,
    })
    if (sent) {
      await sb.from('requests').update({ overdue_notified_at: now.toISOString() }).eq('id', row.id)
      counts.todoDayAfterReminders += 1
    }
  }

  // ======================================================================
  // Phase B — Request "Day after" notice, to the Recipient, plus an
  // un-gated Requestor digest of the same items. Single one-time send —
  // replaces the old moment-of-lapse-transition-plus-open-ended-recurring-
  // nudge design (formerly Phase B/C combined) entirely, per the owner's
  // own 2026-08-22 instruction: "The 'Daily thereafter' should be replaced
  // by the 'Day after'. I don't have any way to know, but the Daily
  // thereafter is most likely to cause spam complaints." Gated on
  // overdue_reminder_enabled (the "Day after" checkbox, migration 037
  // column reused in place — see this file's own header comment and
  // migration 043's); overdue_notified_at (migration 032) is the
  // idempotency marker, now meaning "the Day-after notice has been sent,"
  // not "the Request transitioned to Overdue." A checkbox left off past
  // its own eligible day, or turned on afterward, produces no send and no
  // catch-up — the eligibility window (local date now > due_date, at
  // OVERDUE_HOUR) only exists once.
  //
  // Timing: the RECIPIENT's own local zone (contacts.time_zone, falling
  // back to the owner's own profiles.time_zone) — same reasoning as Phase
  // A1/A1b above, since this notice, like Day before/Day of, is read by
  // the Recipient, not the owner. This is a deliberate change from the old
  // Phase B's owner-zone timing, which made sense for an owner-facing
  // "just became Overdue" transition event that no longer exists; not
  // explicitly confirmed with the owner, flagged here for visibility.
  // ======================================================================
  for (const row of requestRows) {
    if (row.overdue_notified_at || !row.overdue_reminder_enabled || !row.due_date || !row.contacts) continue
    const profile = profileMap.get(row.owner_id) ?? null
    const zone = row.contacts.time_zone ?? profile?.time_zone ?? null
    if (localHour(zone, now) !== OVERDUE_HOUR) continue
    if (!hasLocalDateTimePassed(zone, row.due_date, row.due_time, now)) continue

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
      await sb.from('requests').update({ overdue_notified_at: now.toISOString() }).eq('id', row.id)
      counts.requestDayAfterReminders += 1
      pushDigestItem(overdueDigestItems, row.owner_id, {
        recipientName: row.contacts.display_name ?? row.contacts.email,
        description: row.description,
        dueTime: row.due_time,
        link,
      })
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
      .select(
        'id, display_name, time_zone, todo_dates_enabled, reminder_digest_enabled'
      )
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
