import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

import {
  EMAIL_FROM_ADDRESS,
  buildTrialClosingNoticeSubject,
  buildTrialClosingNoticeHtml,
  buildTrialClosingNoticeText,
} from '@/lib/email'

// nodemailer needs Node's net/tls modules — see send-request/route.ts's own
// comment, same reasoning applies here verbatim.
export const runtime = 'nodejs'

/**
 * POST /api/admin/schedule-trial-close — body `{ closeDate: 'YYYY-MM-DD' |
 * null }`, requires an `Authorization: Bearer <token>` header (an admin's
 * own session). Built 2026-11-16 alongside migration 098 — see that
 * migration's own header comment for the full background (opening signup
 * for Apple's TestFlight review, framed to new signups as a free Private
 * Testing trial).
 *
 * Two steps, in order:
 *
 * 1. Calls schedule_trial_close(p_close_date) with the caller's own
 *    forwarded JWT — that RPC is itself admin-gated and is the one place
 *    the real validation lives (>= 30 days out, or null to cancel). A
 *    rejection there (not an admin, or too soon) is surfaced here as the
 *    real failure; this route never duplicates that check.
 * 2. Only once that write succeeds, AND only when a real date was set (not
 *    a cancel) — service_role (the one genuine reason this route needs
 *    it, same as send-request-update-to-owner/route.ts's identical
 *    posture): queries every account currently on the trial
 *    (trial_subscriber_granted_at set, tier = 'subscriber', no real
 *    stripe_subscription_id — the same three conditions
 *    admin_get_trial_subscriber_count() checks), resolves each one's real
 *    account email via auth.admin.getUserById, and emails them the exact
 *    closing date via buildTrialClosingNoticeSubject/Html/Text. Re-running
 *    this with a different date (a reschedule) re-notifies everyone with
 *    the new date — Jim's own "even if that had to be modified, we could
 *    advise users by email."
 *
 * Canceling a scheduled close (closeDate: null) sends no email at all —
 * a deliberate, flagged scope decision, not an oversight: nobody is
 * losing anything on a cancel, so there's nothing urgent to notify.
 *
 * Every individual send is best-effort — one failed email must never
 * fail the whole request, since the date is already committed by step 1
 * regardless.
 */

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[WYP] Missing environment variable ${name}.`)
  return v
}

function getForwardedClient(authHeader: string) {
  return createClient(must('NEXT_PUBLIC_SUPABASE_URL'), must('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authHeader } },
  })
}

function getServiceRoleClient() {
  return createClient(must('NEXT_PUBLIC_SUPABASE_URL'), must('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
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

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wouldyouplease.com'
}

export async function POST(request: Request) {
  let body: { closeDate?: string | null }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const closeDate = body.closeDate ?? null

  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const forwarded = getForwardedClient(authHeader)
  const { error: rpcError } = await forwarded.rpc('schedule_trial_close', { p_close_date: closeDate })
  if (rpcError) {
    const status = rpcError.message?.includes('authorized') ? 403 : 400
    return Response.json({ error: 'schedule_failed', detail: rpcError.message }, { status })
  }

  if (!closeDate) {
    // Canceling a scheduled close — no email, see header comment.
    return Response.json({ ok: true, notified: 0 })
  }

  const admin = getServiceRoleClient()
  const { data: trialRows, error: queryError } = await admin
    .from('profiles')
    .select('id')
    .not('trial_subscriber_granted_at', 'is', null)
    .eq('tier', 'subscriber')
    .is('stripe_subscription_id', null)

  if (queryError) {
    // The date is already committed — surface this as a real but separate
    // problem, not a reason to report the schedule itself as failed.
    return Response.json({ ok: true, notified: 0, notifyError: queryError.message })
  }

  const transporter = getSmtpTransport()
  if (!transporter) {
    return Response.json({ ok: true, notified: 0, notifyError: 'not_configured' })
  }

  let notified = 0
  for (const row of trialRows ?? []) {
    const { data: userData } = await admin.auth.admin.getUserById(row.id as string)
    const email = userData.user?.email
    if (!email) continue

    try {
      await transporter.sendMail({
        from: `"Would You Please" <${EMAIL_FROM_ADDRESS}>`,
        to: email,
        subject: buildTrialClosingNoticeSubject(),
        text: buildTrialClosingNoticeText({ closeDate, siteUrl: siteUrl() }),
        html: buildTrialClosingNoticeHtml({ closeDate, siteUrl: siteUrl() }),
      })
      notified += 1
    } catch (err) {
      console.error('[admin/schedule-trial-close] notice send failed', email, err)
    }
  }

  return Response.json({ ok: true, notified })
}
