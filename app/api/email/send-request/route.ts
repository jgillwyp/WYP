import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

import { buildIcsContent, type IcsRequestFields } from '@/lib/ics'
import {
  EMAIL_FROM_ADDRESS,
  buildRequestEmailFromName,
  buildRequestEmailHtml,
  buildRequestEmailSubject,
  buildRequestEmailText,
  isReminderEligible,
} from '@/lib/email'

// nodemailer needs Node's net/tls modules — not available on Next's Edge
// runtime. Explicit rather than relying on the (currently correct) default,
// since this route would fail silently/confusingly on Edge with no code
// signal explaining why.
export const runtime = 'nodejs'

/**
 * POST /api/email/send-request — sends the Initial Request email (PRD §7.3).
 * Week 5 Priority 1, see docs/WYP_Week5_Plan.md.
 *
 * Called once, fire-and-forget, from CreateRequestForm.tsx's Send handler
 * right after the new Request row (and its response-link token) exist. This
 * route deliberately does NOT trust the client for anything except which
 * Request to email about and the already-minted response link — description,
 * Due Date/Time, the recipient's address, and the sender's own Display
 * Name/Email are all re-read here from Supabase, scoped by the caller's own
 * forwarded JWT, so a forged or stale client-side payload can't put words in
 * the email that don't match the saved Request. Same "don't trust the
 * client's own copy of the data" posture the SECURITY DEFINER functions
 * already take for /r/[token] — just enforced by RLS here instead of a
 * SECURITY DEFINER function, since this route only ever needs to see what
 * the caller already owns.
 *
 * No service_role anywhere in this file — CLAUDE.md's Database section is
 * explicit that service_role must never go near the browser, and there's no
 * need for it here either: a Supabase client built with the anon key plus
 * the caller's own forwarded access token runs every query as that user,
 * under the exact same RLS policies the browser client already uses.
 *
 * Every failure path still returns 200 with `sent: false` and a `reason` —
 * this must never surface as an error to the person who just successfully
 * saved a Request. Missing SMTP env vars (expected until Jim finishes
 * configuring the mailbox, 2026-08-12) is the same kind of non-error: the
 * Request already saved before this route was ever called.
 *
 * Sends via SMTP (nodemailer) against Jim's own Hostinger mailbox
 * (notifications@wouldyouplease.com), not a transactional-email API like
 * Resend — an earlier draft of this file assumed Resend, per
 * docs/WYP_Week5_Plan.md's original prerequisite list, before Jim actually
 * signed up for Hostinger's mailbox hosting instead. Functionally
 * equivalent for this app's purposes (still From: notifications@wouldyou
 * please.com, still carries the .ics attachment, still returns the same
 * `{ sent, reason }` shape either way) — see the decisions log's 2026-08-12
 * entry for the swap. EMAIL_SMTP_* env vars hold the connection details;
 * EMAIL_SMTP_PASSWORD is a real mailbox password, kept only in
 * `.env.local` (git-ignored — `.env*` in `.gitignore`) and in Vercel's own
 * Environment Variables for production, never in a committed file.
 */

function getSmtpTransport() {
  const host = process.env.EMAIL_SMTP_HOST
  const port = Number(process.env.EMAIL_SMTP_PORT ?? '465')
  const user = process.env.EMAIL_SMTP_USER
  const pass = process.env.EMAIL_SMTP_PASSWORD
  if (!host || !user || !pass) return null

  return nodemailer.createTransport({
    host,
    port,
    // 465 is Hostinger's implicit-TLS port (secure: true, connects already
    // encrypted); 587 would be STARTTLS (secure: false, upgrades after
    // connecting). Derived from the port rather than a separate env var,
    // since the two are never independent in practice.
    secure: port === 465,
    auth: { user, pass },
  })
}

export async function POST(request: Request) {
  let body: { requestId?: string; link?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ sent: false, reason: 'bad_request' }, { status: 400 })
  }

  const requestId = body.requestId
  const link = body.link
  if (!requestId || !link) {
    return Response.json({ sent: false, reason: 'bad_request' }, { status: 400 })
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ sent: false, reason: 'unauthenticated' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json({ sent: false, reason: 'server_misconfigured' }, { status: 500 })
  }

  // Forward the caller's own access token rather than using service_role —
  // every query below runs as that authenticated user, under RLS, exactly
  // like the browser client. persistSession/autoRefreshToken/detectSessionInUrl
  // are all off: this client lives for one request and has nowhere to persist
  // a session to (no browser storage on the server).
  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await sb.auth.getUser()
  if (userError || !userData.user) {
    return Response.json({ sent: false, reason: 'unauthenticated' }, { status: 401 })
  }

  // "requests: owners select own" (migration 003) already scopes this to
  // the caller's own rows — a requestId the caller doesn't own returns no
  // row, same as a forged one. Generic 404 either way, matching the
  // SECURITY DEFINER functions' own "same generic error for every failure"
  // convention (CLAUDE.md, Database section).
  const { data: reqRes, error: reqError } = await sb
    .from('requests')
    .select('id, description, due_date, due_time, reminder_enabled, contacts(email)')
    .eq('id', requestId)
    .single()

  // Same cast-to-a-typed-Row pattern RequestDetailForm.tsx already uses for
  // this identical contacts(...) join shape, rather than defensively
  // handling both the array and single-object cases supabase-js can return
  // for a to-one relationship depending on version/inference.
  type Row = {
    id: string
    description: string
    due_date: string | null
    due_time: string | null
    reminder_enabled: boolean
    contacts: { email: string } | null
  }
  const reqRow = reqRes as unknown as Row | null

  if (reqError || !reqRow || !reqRow.due_date) {
    return Response.json({ sent: false, reason: 'not_found' }, { status: 404 })
  }

  const recipientEmail = reqRow.contacts?.email
  if (!recipientEmail) {
    // A ToDo (contact_id null) or a contact with no stored email — neither
    // should ever reach this route from CreateRequestForm.tsx's own call
    // site, but this is the safety net if it happens anyway.
    return Response.json({ sent: false, reason: 'not_found' }, { status: 404 })
  }

  const { data: profile } = await sb.from('profiles').select('display_name').single()
  const ownerName = profile?.display_name ?? null
  const ownerEmail = userData.user.email ?? ''

  // A reminder is only ever promised in this email when it's both possible
  // (isReminderEligible — Due Date more than two calendar days out) AND the
  // sender left the Reminder checkbox on (reminder_enabled, migration 031,
  // default true). The actual day-before send itself is still unbuilt — see
  // CLAUDE.md's Known gaps — so this only governs whether the Initial
  // email's own "a reminder will arrive" sentence is honest.
  const reminderPromised = isReminderEligible(reqRow.due_date) && reqRow.reminder_enabled
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(link).origin

  const subject = buildRequestEmailSubject('initial', ownerName, reqRow.due_date, reqRow.due_time)
  const emailBodyFields = {
    description: reqRow.description,
    link,
    reminderPromised,
    siteUrl,
    dueDate: reqRow.due_date,
    dueTime: reqRow.due_time,
    ownerName,
  }
  const html = buildRequestEmailHtml(emailBodyFields)
  const text = buildRequestEmailText(emailBodyFields)

  const icsFields: IcsRequestFields = {
    id: reqRow.id,
    description: reqRow.description,
    due_date: reqRow.due_date,
    due_time: reqRow.due_time,
    owner_name: ownerName,
  }
  const icsContent = buildIcsContent(icsFields, link, { reminderPromised })

  const transporter = getSmtpTransport()
  if (!transporter) {
    return Response.json({ sent: false, reason: 'not_configured' }, { status: 200 })
  }

  try {
    await transporter.sendMail({
      from: `"${buildRequestEmailFromName(ownerName)}" <${EMAIL_FROM_ADDRESS}>`,
      to: recipientEmail,
      replyTo: ownerEmail || undefined,
      subject,
      text,
      html,
      attachments: [
        {
          filename: 'request.ics',
          content: icsContent,
          // method=PUBLISH must match the METHOD:PUBLISH property ics.ts now
          // writes into the VCALENDAR body itself — Outlook checks the two
          // against each other and rejected the file when this said REQUEST
          // (a meeting invite) with no METHOD at all in the body. See
          // buildIcsContent's own comment in app/src/lib/ics.ts.
          contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
        },
      ],
    })

    return Response.json({ sent: true }, { status: 200 })
  } catch (err) {
    return Response.json(
      { sent: false, reason: 'send_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 200 }
    )
  }
}
