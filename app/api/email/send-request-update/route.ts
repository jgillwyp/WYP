import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

import {
  EMAIL_FROM_ADDRESS,
  buildRequestEmailFromName,
  buildRequestEmailHtml,
  buildRequestEmailSubject,
  buildRequestEmailText,
  sanitizeChangedFields,
} from '@/lib/email'

// nodemailer needs Node's net/tls modules — see send-request/route.ts's own
// comment, same reasoning applies here verbatim.
export const runtime = 'nodejs'

/**
 * POST /api/email/send-request-update — sends the "UPDATED:" change-
 * notification email to a Request's Recipient, whenever the owner edits an
 * existing Request via Request Detail (2026-09-02, owner request — "I think
 * all changes warrant an email to the other party... We don't currently
 * need an option not to send an email.").
 *
 * Same forwarded-JWT posture as send-request/route.ts, for the same reason:
 * the caller already owns the Request under RLS ("requests: owners select
 * own", migration 003), so there's no cross-user privilege needed here —
 * unlike send-request-update-to-owner/route.ts's own service_role posture,
 * which exists specifically because *that* direction needs to read another
 * user's account email.
 *
 * changedFields is the one piece of information this route *does* trust
 * from the client, by necessity — it describes what the client's own
 * pre-edit snapshot detected changing, information the server has no way to
 * reconstruct from the row's current state alone. Narrowed to
 * CHANGED_FIELD_LABELS via sanitizeChangedFields() before it can appear in
 * an email sent to a third party's inbox — a forged or malformed field name
 * is silently dropped, never passed through.
 *
 * Called fire-and-forget from RequestDetailForm.tsx's Save handler, after
 * the edit itself has already saved successfully — same "never let this
 * block undo or fail the save" posture as CreateRequestForm.tsx's own
 * Initial Request email call. Every failure path returns 200 with
 * `sent: false`.
 */

function getServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )
}

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
  let body: { requestId?: string; link?: string; changedFields?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ sent: false, reason: 'bad_request' }, { status: 400 })
  }

  const requestId = body.requestId
  const link = body.link
  const changedFields = sanitizeChangedFields(body.changedFields)
  if (!requestId || !link || changedFields.length === 0) {
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
    .select('id, description, due_date, due_time, done_date, receipt_confirmation_requested, receipt_confirmed_at, contacts(email)')
    .eq('id', requestId)
    .single()

  type Row = {
    id: string
    description: string
    due_date: string | null
    due_time: string | null
    done_date: string | null
    receipt_confirmation_requested: boolean
    receipt_confirmed_at: string | null
    contacts: { email: string } | null
  }
  const reqRow = reqRes as unknown as Row | null

  if (reqError || !reqRow || !reqRow.due_date) {
    return Response.json({ sent: false, reason: 'not_found' }, { status: 404 })
  }

  // Admin Statistics instrumentation (migration 054, 2026-09-07) — one
  // 'changed' event per change-notification, regardless of how many
  // fields changed (see docs/WYP_Admin_Statistics_Plan.md's "Changed"
  // definition), logged here rather than waiting on the email itself:
  // this route only ever runs when RequestDetailForm.tsx's own Save just
  // succeeded and found a non-empty changedFields list, so reaching this
  // point already means a real, notify-worthy owner edit happened — an
  // SMTP hiccup afterward shouldn't make that edit vanish from the stats.
  // 'done' piggybacks on the same trip whenever Done Date is one of the
  // changed fields and the Request is newly Done (not being un-marked).
  // Uses a fresh service_role client — this route otherwise only ever
  // touches rows via the forwarded/anon-key client `sb`.
  {
    const admin = getServiceRoleClient()
    const events: Array<{
      actor_user: string
      subject_type: 'request'
      subject_id: string
      request_id: string
      action: string
      detail: Record<string, unknown>
    }> = [
      {
        actor_user: userData.user.id,
        subject_type: 'request',
        subject_id: requestId,
        request_id: requestId,
        action: 'changed',
        detail: { fields: changedFields },
      },
    ]
    if (changedFields.includes('Done Date') && reqRow.done_date) {
      events.push({
        actor_user: userData.user.id,
        subject_type: 'request',
        subject_id: requestId,
        request_id: requestId,
        action: 'done',
        detail: { done_date: reqRow.done_date },
      })
    }
    await admin.from('events').insert(events)
  }

  const recipientEmail = reqRow.contacts?.email
  if (!recipientEmail) {
    return Response.json({ sent: false, reason: 'not_found' }, { status: 404 })
  }

  const { data: profile } = await sb.from('profiles').select('display_name').single()
  const ownerName = profile?.display_name ?? null
  const ownerEmail = userData.user.email ?? ''

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(link).origin

  const subject = buildRequestEmailSubject('updated', ownerName, reqRow.due_date, reqRow.due_time)
  const emailBodyFields = {
    description: reqRow.description,
    link,
    changedFields,
    siteUrl,
    dueDate: reqRow.due_date,
    dueTime: reqRow.due_time,
    ownerName,
    doneDate: reqRow.done_date,
    // Receipt Confirmation (2026-09-24) — see email.ts's own comment on
    // offerReceiptConfirmation for the full reasoning.
    offerReceiptConfirmation: reqRow.receipt_confirmation_requested && !reqRow.receipt_confirmed_at,
  }
  const html = buildRequestEmailHtml(emailBodyFields)
  const text = buildRequestEmailText(emailBodyFields)

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
    })

    return Response.json({ sent: true }, { status: 200 })
  } catch (err) {
    return Response.json(
      { sent: false, reason: 'send_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 200 }
    )
  }
}
