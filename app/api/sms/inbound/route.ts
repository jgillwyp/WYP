import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

// twilio's signature-validation helper and the Supabase service_role client
// both need Node, not Edge.
export const runtime = 'nodejs'

/**
 * POST /api/sms/inbound — Twilio's "A MESSAGE COMES IN" webhook (2026-10-13,
 * migration 079's Request Texting verification flow). Configure this route's
 * full URL (NEXT_PUBLIC_SITE_URL + /api/sms/inbound) as the inbound webhook
 * on the Twilio phone number / Messaging Service in the Twilio console — a
 * console-side step, not something this code can do.
 *
 * This is the "native STOP/HELP keyword" half of Jim's "both" answer — the
 * other half is the web link in app/textmessaging's own Manage/Stop state
 * (set_sms_opt_out, called with a token, not a phone number). Recommend
 * ALSO enabling Twilio's own Advanced Opt-Out (Messaging Service ->
 * Integration) so Twilio sends the actual carrier-compliant auto-reply text
 * for STOP/HELP/START itself — this route only ever updates WYP's own
 * database so Contact Detail and future send-gating can reflect an opt-out;
 * it deliberately returns an EMPTY TwiML response rather than writing its
 * own reply text, so it never fights with whatever Twilio's own console-
 * level auto-reply sends.
 *
 * service_role is used here, same narrow and already-established exception
 * CLAUDE.md's Database section carves out for Attachments/cron — an inbound
 * webhook has no WYP session for RLS to scope to at all, and the only write
 * this route ever makes is through set_sms_opt_out_by_phone, which matches
 * on sms_consent_phone (not a raw table write).
 *
 * Every request is signature-verified (X-Twilio-Signature, HMAC-SHA1 over
 * the exact webhook URL + sorted form params, keyed by TWILIO_AUTH_TOKEN) —
 * this endpoint is otherwise publicly reachable, so an unverified request
 * could forge an opt-out for an arbitrary phone number. An unverified
 * request is rejected outright (403), not silently ignored, so a
 * misconfigured webhook URL in the Twilio console is loud rather than a
 * quiet no-op.
 */

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])
// Twilio's own default opt-in keywords. START re-opts a Contact back in
// (migration 105) -- previously unhandled, so a recorded STOP was permanent
// on WYP's side even after Twilio itself unblocked the number.
const START_KEYWORDS = new Set(['START', 'UNSTOP', 'YES'])

function emptyTwimlResponse() {
  const twiml = new twilio.twiml.MessagingResponse()
  return new Response(twiml.toString(), {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (!authToken || !siteUrl) {
    return new Response('Server misconfigured.', { status: 500 })
  }

  const rawBody = await request.text()
  const params = Object.fromEntries(new URLSearchParams(rawBody))

  const signature = request.headers.get('x-twilio-signature')
  // Deterministic, matching exactly what Jim configures in the Twilio
  // console — not built from request.url, which can reflect proxy-internal
  // scheme/host details Twilio never signed against.
  const webhookUrl = `${siteUrl}/api/sms/inbound`

  if (!signature || !twilio.validateRequest(authToken, signature, webhookUrl, params)) {
    // Logged (2026-11-24): this route previously wrote nothing to the log at
    // all, so a misconfigured console URL (e.g. the bare apex, which 308s to
    // www and signs against a different URL) was invisible in Vercel's logs.
    console.error('[sms/inbound] signature rejected', { webhookUrl, hasSignature: !!signature })
    return new Response('Invalid signature.', { status: 403 })
  }

  const from = typeof params.From === 'string' ? params.From : null
  const body = typeof params.Body === 'string' ? params.Body.trim().toUpperCase() : ''
  // With Twilio's Advanced Opt-Out on, OptOutType ('STOP' | 'START' | 'HELP')
  // reports Twilio's own classification, including any custom keywords set
  // in the console -- trusted first, the plain keyword match as a fallback.
  const optOutType = typeof params.OptOutType === 'string' ? params.OptOutType.toUpperCase() : ''
  const isStop = optOutType === 'STOP' || STOP_KEYWORDS.has(body)
  const isStart = optOutType === 'START' || START_KEYWORDS.has(body)

  console.log('[sms/inbound] received', { from, body, optOutType })

  if (from && (isStop || isStart)) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (supabaseUrl && serviceRoleKey) {
      const sb = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const fn = isStop ? 'set_sms_opt_out_by_phone' : 'set_sms_opt_in_by_phone'
      const { data, error } = await sb.rpc(fn, { p_phone: from })
      if (error) {
        console.error('[sms/inbound] ' + fn + ' failed', { from, error: error.message })
      } else {
        // 0 means no Contact's sms_consent_phone matched this number exactly.
        console.log('[sms/inbound] ' + fn, { from, contactsUpdated: data })
      }
    } else {
      console.error('[sms/inbound] Supabase service role not configured')
    }
  }

  return emptyTwimlResponse()
}
