import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

import {
  EMAIL_FROM_ADDRESS,
  buildSmsConsentApprovedEmailHtml,
  buildSmsConsentApprovedEmailSubject,
  buildSmsConsentApprovedEmailText,
} from '@/lib/email'

// nodemailer needs Node's net/tls — see send-request/route.ts's identical
// comment.
export const runtime = 'nodejs'

/**
 * POST /api/sms/notify-consent-approved — the "Notify me when this is
 * approved" half of the Request Texting consent flow (2026-10-20, migration
 * 082). Called fire-and-forget by TextMessagingForm.tsx right after a
 * successful set_sms_consent on the anonymous /textmessaging page — this
 * route never blocks or affects that page's own success state.
 *
 * mark_sms_consent_notified(token) does all the real work: it looks up the
 * Contact by the same token hash set_sms_consent already used, checks
 * sms_consent_notify_owner was actually opted into, and atomically marks
 * sms_consent_notified_at so a retry (or a double network call) can never
 * send this email twice. This route only acts on a should_notify: true
 * result — never trusts a client-supplied owner id or contact name.
 *
 * Needs service_role for the one step nothing else can do:
 * auth.admin.getUserById to resolve the owner's real account email. Same
 * narrow, already-established exception as send-request-update-to-owner/
 * route.ts — used only after mark_sms_consent_notified has already
 * confirmed, server-side, that this specific notification is real and due.
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
  let body: { token?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ sent: false, reason: 'bad_request' }, { status: 400 })
  }

  const token = body.token
  if (!token) {
    return Response.json({ sent: false, reason: 'bad_request' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json({ sent: false, reason: 'server_misconfigured' }, { status: 500 })
  }

  const anon = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await anon.rpc('mark_sms_consent_notified', { p_token: token })
  if (error || !data) {
    return Response.json({ sent: false, reason: 'not_found' }, { status: 200 })
  }

  const result = data as {
    should_notify: boolean
    owner_id?: string
    contact_id?: string
    contact_name?: string
  }
  if (!result.should_notify || !result.owner_id || !result.contact_id || !result.contact_name) {
    return Response.json({ sent: false, reason: 'not_applicable' }, { status: 200 })
  }

  const sbc = createClient(must('NEXT_PUBLIC_SUPABASE_URL'), must('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: ownerUser } = await sbc.auth.admin.getUserById(result.owner_id)
  const ownerEmail = ownerUser.user?.email ?? null
  if (!ownerEmail) {
    return Response.json({ sent: false, reason: 'not_found' }, { status: 200 })
  }

  const fields = {
    contactName: result.contact_name,
    link: `${siteUrl()}/contacts/${result.contact_id}`,
    siteUrl: siteUrl(),
  }
  const subject = buildSmsConsentApprovedEmailSubject(result.contact_name)
  const html = buildSmsConsentApprovedEmailHtml(fields)
  const text = buildSmsConsentApprovedEmailText(fields)

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
