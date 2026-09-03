import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

import {
  EMAIL_FROM_ADDRESS,
  buildOwnerUpdateEmailHtml,
  buildOwnerUpdateEmailSubject,
  buildOwnerUpdateEmailText,
  sanitizeChangedFields,
} from '@/lib/email'

// nodemailer needs Node's net/tls modules — see send-request/route.ts's own
// comment, same reasoning applies here verbatim.
export const runtime = 'nodejs'

/**
 * POST /api/email/send-request-update-to-owner — the other direction of the
 * "UPDATED:" change-notification feature (2026-09-02, owner request — see
 * send-request-update/route.ts's own header comment for the full context).
 * Sent to the Request's owner/Requestor whenever the Recipient edits an
 * existing Request: Done Date/Time, a Dialog entry, or an Attachment, from
 * either Response Detail (a signed-in recipient) or Request Response (the
 * anonymous /r/[token] path).
 *
 * Unlike send-request-update/route.ts, this direction genuinely needs
 * cross-user privilege — the caller here is the Recipient, not the owner,
 * and the email has to go to the *owner's* own account email, which nothing
 * short of service_role (via auth.admin.getUserById) can read. This is the
 * same justified, narrow exception CLAUDE.md already carves out for the
 * Attachments API routes and app/api/cron/tick/route.ts: service_role never
 * touches the browser directly, and every write/read this route performs is
 * gated behind an explicit permission check first, using the exact same
 * RPCs the recipient-facing screens themselves already call — a caller who
 * couldn't open Response Detail or /r/[token] for this Request can't get an
 * email sent through this route either.
 *
 * Two mutually exclusive callers, exactly one of which must be supplied:
 *   - `token` — the anonymous /r/[token] path (RequestResponseForm.tsx).
 *     Verified by calling the existing anon-callable get_request_by_token
 *     RPC; success returns the Request's own id, which is trusted from here
 *     on — the same verification that RPC already performs for every other
 *     read/write on that path.
 *   - `requestId` + a forwarded Authorization header — the signed-in
 *     recipient path (ResponseDetailForm.tsx). Verified by calling the
 *     existing get_received_request RPC (already scopes to a Contact whose
 *     email matches the caller's own session email) with the caller's own
 *     forwarded JWT; success confirms the caller really is this Request's
 *     recipient.
 *
 * changedFields is trusted from the client for the same reason
 * send-request-update/route.ts's own comment gives — sanitized against the
 * same CHANGED_FIELD_LABELS allow-list before it can reach an email.
 *
 * The email links to the owner's own /requests/[id] Request Detail screen,
 * not a minted /r/[token] link — only the owner can open that route (RLS
 * owner-only), so no token needs minting for this direction at all.
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

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing environment variable ${name}.`)
  return v
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wouldyouplease.com'
}

export async function POST(request: Request) {
  let body: { requestId?: string; token?: string; changedFields?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ sent: false, reason: 'bad_request' }, { status: 400 })
  }

  const changedFields = sanitizeChangedFields(body.changedFields)
  if (changedFields.length === 0) {
    return Response.json({ sent: false, reason: 'bad_request' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json({ sent: false, reason: 'server_misconfigured' }, { status: 500 })
  }

  // Verify the caller's permission first, using an anon-key client (plus the
  // caller's own forwarded JWT for the signed-in-recipient path) — never
  // service_role for this step. Resolves to a single verified requestId.
  let requestId: string | null = null

  if (body.token) {
    const anon = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await anon.rpc('get_request_by_token', { p_token: body.token })
    if (error || !data) {
      return Response.json({ sent: false, reason: 'not_found' }, { status: 404 })
    }
    requestId = (data as { id: string }).id
  } else if (body.requestId) {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return Response.json({ sent: false, reason: 'unauthenticated' }, { status: 401 })
    }
    const forwarded = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: authHeader } },
    })
    const { data, error } = await forwarded.rpc('get_received_request', { p_request_id: body.requestId })
    if (error || !data) {
      return Response.json({ sent: false, reason: 'not_found' }, { status: 404 })
    }
    requestId = body.requestId
  } else {
    return Response.json({ sent: false, reason: 'bad_request' }, { status: 400 })
  }

  // Permission confirmed — now use service_role to read the fields this
  // email needs (owner_id, for the account-email lookup below, plus the
  // Request's own data) and to look up the owner's real account email.
  // Neither is reachable from the anon/forwarded-JWT clients above: the
  // Recipient has no RLS path to the owner's own auth.users row, by design.
  const sbc = createClient(must('NEXT_PUBLIC_SUPABASE_URL'), must('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const { data: reqRes, error: reqError } = await sbc
    .from('requests')
    .select('id, owner_id, description, due_date, due_time, contacts(display_name)')
    .eq('id', requestId)
    .single()

  type Row = {
    id: string
    owner_id: string
    description: string
    due_date: string | null
    due_time: string | null
    contacts: { display_name: string | null } | null
  }
  const reqRow = reqRes as unknown as Row | null

  if (reqError || !reqRow || !reqRow.due_date) {
    return Response.json({ sent: false, reason: 'not_found' }, { status: 404 })
  }

  const { data: ownerUser } = await sbc.auth.admin.getUserById(reqRow.owner_id)
  const ownerEmail = ownerUser.user?.email ?? null
  if (!ownerEmail) {
    return Response.json({ sent: false, reason: 'not_found' }, { status: 404 })
  }

  const recipientName = reqRow.contacts?.display_name ?? null
  const link = `${siteUrl()}/requests/${reqRow.id}`

  const subject = buildOwnerUpdateEmailSubject(recipientName, reqRow.due_date, reqRow.due_time)
  const emailBodyFields = {
    recipientName,
    description: reqRow.description,
    dueDate: reqRow.due_date,
    dueTime: reqRow.due_time,
    changedFields,
    link,
    siteUrl: siteUrl(),
  }
  const html = buildOwnerUpdateEmailHtml(emailBodyFields)
  const text = buildOwnerUpdateEmailText(emailBodyFields)

  const transporter = getSmtpTransport()
  if (!transporter) {
    return Response.json({ sent: false, reason: 'not_configured' }, { status: 200 })
  }

  try {
    await transporter.sendMail({
      from: `"Would You Please" <${EMAIL_FROM_ADDRESS}>`,
      to: ownerEmail,
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
