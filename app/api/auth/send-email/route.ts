import nodemailer from 'nodemailer'
import { Webhook, WebhookVerificationError } from 'standardwebhooks'

import {
  EMAIL_FROM_ADDRESS,
  buildSignInEmailHtml,
  buildSignInEmailSubject,
  buildSignInEmailText,
} from '@/lib/email'

// nodemailer needs Node's net/tls modules — not available on Next's Edge
// runtime, same reasoning every other SMTP-sending route in this app already
// states explicitly.
export const runtime = 'nodejs'

/**
 * POST /api/auth/send-email — Supabase "Send Email" Auth Hook (2026-11-01;
 * simplified to always code-only, 2026-11-03).
 * Configure this route's full URL (NEXT_PUBLIC_SITE_URL + /api/auth/send-email)
 * in the Supabase Dashboard under Authentication -> Hooks -> Send Email,
 * type HTTPS. Once registered there, Supabase stops sending auth emails
 * through its own built-in mailer/template entirely and calls this route
 * instead for every one — in this app's case, that's only ever the magic-
 * link sign-in email (no password-reset/invite/signup-confirmation flows
 * exist here; the private-testing gate, can_create_account(), already blocks
 * a genuinely new/non-allowlisted email before signInWithOtp is ever called,
 * so this route never needs to reason about that gate itself).
 *
 * Exists so this module controls the sign-in email's actual content instead
 * of Supabase's own built-in Magic Link template. Originally built to
 * conditionally omit the clickable link for a context where it's known not
 * to work (the native TestFlight/Capacitor app, or an iOS home-screen icon —
 * both have their own isolated storage, so a tapped link always opens the
 * device's regular browser instead of signing in where the user actually
 * is) — that condition is gone as of 2026-11-03: the owner found the code
 * just as fast even where the link worked fine (a Windows PWA in Chrome),
 * so the email is now code-only unconditionally, every platform, and this
 * route no longer needs to know anything about the original request's
 * context (no more `?ctx=app` query param to read off `redirect_to`). See
 * app/src/lib/email.ts's own "Sign-in email" section header comment for the
 * full history.
 *
 * Signature verification (standardwebhooks, the same "Standard Webhooks"
 * spec Supabase's own docs and example Edge Functions use) is mandatory —
 * this endpoint is otherwise publicly reachable, and once it's registered in
 * the dashboard it's the ONLY way any real user ever receives a sign-in
 * email, so an unverified request here could both forge sign-in emails to
 * arbitrary addresses and, if this route is ever broken, silently lock every
 * real user out of signing in at all. The secret is base64, shown in the
 * dashboard's Auth Hooks section prefixed "v1,whsec_..." — SUPABASE_AUTH_HOOK_
 * SECRET holds that value verbatim (the "v1,whsec_" prefix is stripped below
 * to match the exact convention Supabase's own example code uses), kept only
 * in .env.local (git-ignored) and Vercel's Environment Variables, never in a
 * committed file.
 *
 * Response contract matches Supabase's own documented example exactly:
 * success is status 200 with an empty JSON object; any failure (signature,
 * payload, or the actual SMTP send) is status 401 with
 * `{ error: { http_code, message } }` — Supabase surfaces that failure back
 * to the client's signInWithOtp() call as a real error, which is the correct
 * behavior here: unlike every other email route in this app (fire-and-forget
 * against an already-saved Request), there is nothing else this call could
 * have "already succeeded" at — if the sign-in email can't be sent, the user
 * needs to know, not be told sign-in worked when no email is coming.
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

function failure(httpCode: number, message: string) {
  return Response.json({ error: { http_code: httpCode, message } }, { status: 401 })
}

type SendEmailHookPayload = {
  user?: { email?: string }
  email_data?: {
    token?: string
    redirect_to?: string
  }
}

export async function POST(request: Request) {
  const hookSecret = process.env.SUPABASE_AUTH_HOOK_SECRET
  if (!hookSecret) {
    // Fail closed — once this hook is registered in the Supabase dashboard,
    // there is no "fall back to the built-in mailer" option, so a missing
    // secret has to surface as a loud sign-in failure rather than silently
    // accepting an unverifiable request.
    return failure(500, 'Server misconfigured: SUPABASE_AUTH_HOOK_SECRET is not set.')
  }

  const rawBody = await request.text()
  const headers = Object.fromEntries(request.headers)

  let payload: SendEmailHookPayload
  try {
    const wh = new Webhook(hookSecret.replace(/^v1,/, ''))
    payload = wh.verify(rawBody, headers) as SendEmailHookPayload
  } catch (err) {
    const message = err instanceof WebhookVerificationError ? err.message : 'Invalid signature.'
    return failure(401, message)
  }

  const email = payload.user?.email
  const emailData = payload.email_data
  if (!email || !emailData?.token || !emailData?.redirect_to) {
    return failure(400, 'Malformed hook payload.')
  }

  // redirect_to is only read here now for its origin, as a fallback if
  // NEXT_PUBLIC_SITE_URL somehow isn't set — the email itself is code-only
  // (see this route's own header comment), so there's no verify link left
  // to build from token_hash/email_action_type, and nothing left to decide
  // based on redirect_to's own query string either.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(emailData.redirect_to).origin

  const fields = {
    code: emailData.token,
    siteUrl,
  }

  const transporter = getSmtpTransport()
  if (!transporter) {
    return failure(500, 'Server misconfigured: SMTP credentials are not set.')
  }

  try {
    await transporter.sendMail({
      from: `"Would You Please" <${EMAIL_FROM_ADDRESS}>`,
      to: email,
      subject: buildSignInEmailSubject(),
      text: buildSignInEmailText(fields),
      html: buildSignInEmailHtml(fields),
    })
  } catch (err) {
    return failure(500, err instanceof Error ? err.message : 'Failed to send sign-in email.')
  }

  return Response.json({}, { status: 200 })
}
