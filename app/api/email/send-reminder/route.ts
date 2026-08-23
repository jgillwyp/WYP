import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

import {
  EMAIL_FROM_ADDRESS,
  buildRequestEmailFromName,
  buildOverdueRecipientEmailSubject,
  buildOverdueRecipientEmailHtml,
  buildOverdueRecipientEmailText,
} from '@/lib/email'

// nodemailer needs Node's net/tls — see send-request/route.ts's identical
// comment.
export const runtime = 'nodejs'

/**
 * POST /api/email/send-reminder — the manual "Send Reminder" button on
 * Request Detail (owner request, 2026-08-22, the item raised alongside the
 * "Day after" simplification batch and left open until now): "On Request
 * Detail, if it is overdue, show the Due Date in red and add a 'Send
 * Reminder' button... The reminder would go out either immediately or in
 * the next cron cycle. This would accommodate a Requestor who does not
 * want automated notifications sent out."
 *
 * Reuses the exact Overdue notice template (buildOverdueRecipientEmail
 * Subject/Html/Text) the cron route's own automatic "Day after" send
 * already uses (app/api/cron/tick/route.ts) — same content, different
 * trigger. Deliberately does NOT touch requests.overdue_notified_at: that
 * column is the automatic "Day after" checkbox's own one-shot idempotency
 * marker, and a manual send here is independent of it by design — an
 * owner who has all three Reminder checkboxes off, or whose Day-after
 * window already fired or hasn't yet, can still click this button whenever
 * they want, and doing so must never suppress or fast-forward the
 * automatic system's own separate state.
 *
 * Same posture as send-request/route.ts, not cron/tick/route.ts: this is
 * triggered by the signed-in owner from the browser, so it runs as that
 * user (anon key + forwarded Authorization header, under RLS) rather than
 * service_role — CLAUDE.md's Database section is explicit that
 * service_role must never go near the browser, and there's no need for it
 * here either, unlike the cron route, which has no session to scope to at
 * all. `requests` RLS ("owners select own," migration 003) already scopes
 * the select below to the caller's own rows.
 *
 * The response-link token is minted client-side by RequestDetailForm.tsx
 * via the existing owner-only `issue_request_link` RPC (migration 008) —
 * same call CreateRequestForm.tsx's own automatic Initial-email flow
 * already makes — and passed in here as `link`, not re-derived
 * server-side, since only the RPC caller's own session can mint one.
 *
 * Every failure path still returns 200 with `sent: false` and a `reason`,
 * matching send-request/route.ts's own convention — but unlike that
 * route, a failure here IS surfaced to the person who clicked the button
 * (RequestDetailForm.tsx shows it inline), since this is a deliberate,
 * in-the-moment action they're waiting on, not a fire-and-forget
 * background email.
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

  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await sb.auth.getUser()
  if (userError || !userData.user) {
    return Response.json({ sent: false, reason: 'unauthenticated' }, { status: 401 })
  }

  const { data: reqRes, error: reqError } = await sb
    .from('requests')
    .select('id, description, due_date, due_time, done_date, archived_at, contacts(email)')
    .eq('id', requestId)
    .single()

  type Row = {
    id: string
    description: string
    due_date: string | null
    due_time: string | null
    done_date: string | null
    archived_at: string | null
    contacts: { email: string } | null
  }
  const reqRow = reqRes as unknown as Row | null

  if (reqError || !reqRow || !reqRow.due_date) {
    return Response.json({ sent: false, reason: 'not_found' }, { status: 404 })
  }

  const recipientEmail = reqRow.contacts?.email
  if (!recipientEmail) {
    return Response.json({ sent: false, reason: 'not_found' }, { status: 404 })
  }

  // Guard against a stale button click (e.g. the Request was marked Done
  // or archived in another tab/device between page load and this click) —
  // the button itself is only ever rendered/enabled while overdue and
  // un-archived, but this route re-checks server-side rather than trusting
  // the client's own state, same "don't trust the client" posture every
  // other route in this app takes.
  if (reqRow.done_date || reqRow.archived_at) {
    return Response.json({ sent: false, reason: 'not_overdue' }, { status: 200 })
  }

  const { data: profile } = await sb.from('profiles').select('display_name').single()
  const ownerName = profile?.display_name ?? null
  const ownerEmail = userData.user.email ?? ''
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(link).origin

  const fields = {
    ownerName,
    description: reqRow.description,
    dueDate: reqRow.due_date,
    dueTime: reqRow.due_time,
    link,
    siteUrl,
  }

  const transporter = getSmtpTransport()
  if (!transporter) {
    return Response.json({ sent: false, reason: 'not_configured' }, { status: 200 })
  }

  try {
    await transporter.sendMail({
      from: `"${buildRequestEmailFromName(ownerName)}" <${EMAIL_FROM_ADDRESS}>`,
      to: recipientEmail,
      replyTo: ownerEmail || undefined,
      subject: buildOverdueRecipientEmailSubject(ownerName, reqRow.due_date, reqRow.due_time),
      text: buildOverdueRecipientEmailText(fields),
      html: buildOverdueRecipientEmailHtml(fields),
    })

    return Response.json({ sent: true }, { status: 200 })
  } catch (err) {
    return Response.json(
      { sent: false, reason: 'send_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 200 }
    )
  }
}
