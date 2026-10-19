// Request Texting — SMS send helper and message templates (2026-10-19,
// Campaign CMbc5fab6b72c0e51c046b1599d7da0d3f, Messaging Service
// MG645f985709a4a131463c4c102df96dd8). Pure template builders (no env
// access, matching email.ts's own isomorphic convention), plus sendSms(),
// which makes the actual Twilio REST call.
//
// First-pass scope, per Jim's own answer when this was scoped: "Request
// and Reminders by text if indicated" — Initial Request and the
// day-before/day-of/day-after Reminders only. The approved campaign's five
// sample messages also cover an Update notification and a standalone
// Receipt Confirmation text, but neither is wired up yet; extend
// contactSmsNumber's call sites to cover them later if wanted.
//
// Wording follows the approved campaign's sample messages as closely as
// real data allows — platform-centric phrasing ("via <name>'s account"),
// not person-centric ("<name> sent you..."), since that framing is what
// got the campaign description past Twilio's "sounds like P2P" rejection
// the first time around (see CLAUDE.md's 2026-10-19 history). Real
// response links carry a 64-character hex token, longer than the approved
// sample's own bracketed "[token]" placeholder, so a real message will
// usually run past the 160-character single-segment limit and send as two
// segments — flagged during registration, not a functional problem, just
// a per-message cost note.

function formatMDY(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${m}-${d}-${y.slice(2)}`
}

function formatTime12h(value: string): string {
  const [hStr, mStr] = value.split(':')
  let h = parseInt(hStr, 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${mStr} ${ampm}`
}

function dueClause(dueDate: string, dueTime: string | null): string {
  return formatMDY(dueDate) + (dueTime && dueTime.trim() !== '' ? ` ${formatTime12h(dueTime)}` : '')
}

function ownerClause(ownerName: string | null): string {
  return ownerName ? ` via ${ownerName}'s account` : ''
}

// Receipt Confirmation clause (2026-10-19, Jim's own suggested wording) —
// appended to the Initial Request/Reminder SMS when the Request has it
// requested and not yet confirmed, same gate (receipt_confirmation_requested
// && !receipt_confirmed_at) every call site already computes for its own
// email equivalent. One shared clause rather than a separate SMS template,
// since the approved campaign's own "Receipt Confirmation" sample message
// (#5) and its Initial Request/Reminder samples are all one declared
// content category — this is a sentence within that category, not a new
// message type.
function confirmReceiptClause(offerReceiptConfirmation: boolean | undefined): string {
  return offerReceiptConfirmation ? ' Please click to confirm receipt.' : ''
}

export function buildInitialRequestSmsBody(opts: {
  ownerName: string | null
  dueDate: string
  dueTime: string | null
  link: string
  offerReceiptConfirmation?: boolean
}): string {
  return `Would You Please: You have a new task Request${ownerClause(opts.ownerName)}, due ${dueClause(
    opts.dueDate,
    opts.dueTime
  )}.${confirmReceiptClause(opts.offerReceiptConfirmation)} ${opts.link} Reply STOP to opt out, HELP for help.`
}

export type ReminderSmsKind = 'day_before' | 'day_of' | 'overdue'

export function buildReminderSmsBody(opts: {
  kind: ReminderSmsKind
  ownerName: string | null
  dueDate: string
  dueTime: string | null
  link: string
  offerReceiptConfirmation?: boolean
}): string {
  const owner = ownerClause(opts.ownerName)
  const due = dueClause(opts.dueDate, opts.dueTime)
  const lead =
    opts.kind === 'overdue'
      ? `A task Request${owner}, due ${due}, is now overdue.`
      : opts.kind === 'day_of'
        ? `Reminder - a task Request${owner} is due today, ${due}.`
        : `Reminder - a task Request${owner} is due tomorrow, ${due}.`
  return `Would You Please: ${lead}${confirmReceiptClause(opts.offerReceiptConfirmation)} ${opts.link} Reply STOP to opt out, HELP for help.`
}

// ----------------------------------------------------------------------------
// Eligibility — a Contact sends by text only once they've explicitly chosen
// Text (send_by), completed the web-based opt-in (sms_consent_given_at not
// null), and haven't since opted back out (sms_opted_out_at null). Returns
// the number to text — sms_consent_phone, the number actually confirmed
// through the opt-in form, not the plain `phone` column a Contact's own
// record may have been edited to since — or null to mean "fall back to
// email."
// ----------------------------------------------------------------------------
export type SmsEligibleContact = {
  send_by: 'email' | 'text'
  sms_consent_phone: string | null
  sms_consent_given_at: string | null
  sms_opted_out_at: string | null
}

export function contactSmsNumber(contact: SmsEligibleContact | null | undefined): string | null {
  if (!contact) return null
  if (contact.send_by !== 'text') return null
  if (!contact.sms_consent_given_at || contact.sms_opted_out_at) return null
  return contact.sms_consent_phone
}

// ----------------------------------------------------------------------------
// sendSms — one Twilio REST call via fetch, the same lean-dependency
// posture this codebase's own nodemailer-based email sending already
// takes (no heavier SDK wrapper beyond what's actually needed — the
// `twilio` package stays scoped to app/api/sms/inbound/route.ts's own
// signature verification). TWILIO_MESSAGING_SERVICE_SID picks the
// approved, link-capable campaign's Messaging Service, never a bare `From`
// number, so Twilio's own A2P 10DLC compliance routing applies. Every
// failure path returns sent:false rather than throwing, matching every
// email route's own "never let a notification failure surface as an error
// to someone who already successfully saved" posture.
// ----------------------------------------------------------------------------
export type SmsSendResult = { sent: boolean; reason?: string; detail?: string }

// ----------------------------------------------------------------------------
// shortenSmsLink — wraps a long /r/[token] link behind a short, first-party
// /s/<code> redirect (migration 081), so an SMS has room left for its own
// text after the link. First-party, not a third-party shortener (bit.ly,
// etc.): the approved campaign's own "Embedded links sample" was reviewed
// and approved showing a real wouldyouplease.com URL, and a generic
// shortener domain is itself a well-known carrier spam-filter trigger.
// Takes a Supabase client rather than creating its own, since this module
// otherwise stays free of any particular env/client wiring — the caller
// already has one. Never blocks the send over a failed shorten; falls back
// to the original, full-length link.
// ----------------------------------------------------------------------------
export async function shortenSmsLink(
  sb: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  url: string
): Promise<string> {
  try {
    const { data, error } = await sb.rpc('create_short_link', { p_target_url: url })
    if (error || typeof data !== 'string') return url
    return `${new URL(url).origin}/s/${data}`
  } catch {
    return url
  }
}

export async function sendSms(to: string, body: string): Promise<SmsSendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
  if (!accountSid || !authToken || !messagingServiceSid) {
    return { sent: false, reason: 'not_configured' }
  }

  const params = new URLSearchParams({ To: to, MessagingServiceSid: messagingServiceSid, Body: body })
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
      body: params.toString(),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { sent: false, reason: 'send_failed', detail }
    }
    return { sent: true }
  } catch (err) {
    return { sent: false, reason: 'send_failed', detail: err instanceof Error ? err.message : String(err) }
  }
}
