import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

import { buildSmsConsentEmailHtml, buildSmsConsentEmailSubject, buildSmsConsentEmailText } from '@/lib/email'

export const runtime = 'nodejs'

/**
 * POST /api/sms/send-consent-request — sends the "please approve text
 * messaging" email (2026-10-13, migration 079's Request Texting
 * verification flow). Mirrors app/api/email/send-request/route.ts's own
 * posture exactly: forwarded-JWT, no service_role, every failure path
 * still returns 200 with `sent: false` so a Contact Save that already
 * succeeded never surfaces this as an error. Deliberately does NOT trust
 * the client for the Contact's own email or the owner's own display name —
 * both are re-read here, scoped by "contacts: owners select own" RLS, so a
 * forged or stale client payload can't put words in the email that don't
 * match the saved Contact. Only the Contact id and the already-minted
 * consent-link token (via request_sms_consent, called client-side the same
 * way issue_request_link already is for a Request) come from the client.
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
  let body: { contactId?: string; link?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ sent: false, reason: 'bad_request' }, { status: 400 })
  }

  const contactId = body.contactId
  const link = body.link
  if (!contactId || !link) {
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

  const { data: contactRow, error: contactError } = await sb
    .from('contacts')
    .select('email')
    .eq('id', contactId)
    .single()

  if (contactError || !contactRow || !contactRow.email) {
    return Response.json({ sent: false, reason: 'not_found' }, { status: 404 })
  }

  const { data: profile } = await sb.from('profiles').select('display_name').single()
  const ownerName = profile?.display_name ?? null
  if (!ownerName) {
    // buildSmsConsentEmailSubject/Html/Text all need a real name for the
    // carrier-required "on behalf of [User Name]" consent sentence — see
    // email.ts's own comment on SmsConsentEmailFields. Rather than send a
    // blank or fall back to the app's own name (the exact mistake
    // buildRequestEmailHtml's "from Would You Please" bug already taught
    // this codebase to avoid, 2026-08-13), refuse to send and surface it
    // as a distinct reason so the UI can explain Account Options needs a
    // Display Name first.
    return Response.json({ sent: false, reason: 'owner_name_missing' }, { status: 200 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(link).origin
  const subject = buildSmsConsentEmailSubject(ownerName)
  const emailFields = { ownerName, link, siteUrl }
  const html = buildSmsConsentEmailHtml(emailFields)
  const text = buildSmsConsentEmailText(emailFields)

  const transporter = getSmtpTransport()
  if (!transporter) {
    return Response.json({ sent: false, reason: 'not_configured' }, { status: 200 })
  }

  try {
    await transporter.sendMail({
      from: `"${ownerName} via Would You Please" <notifications@wouldyouplease.com>`,
      to: contactRow.email,
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
