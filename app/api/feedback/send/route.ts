import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

import { EMAIL_FROM_ADDRESS } from '@/lib/email'

// nodemailer needs Node's net/tls — see send-request/route.ts's identical
// comment.
export const runtime = 'nodejs'

/**
 * POST /api/feedback/send — Private Tester Feedback (2026-10-21, owner's
 * own mockup). Deliberately temporary: a direct channel for the
 * 12-tester/14-day Android closed-testing period, not a permanent feature
 * — nothing about this route's design (no stored record of a submission,
 * no admin inbox inside the app) assumes it needs to outlive that period.
 *
 * Same forwarded-JWT, no-service_role posture as every other owner-session
 * email route (send-request/route.ts, send-reminder/route.ts) — the
 * sender's own email is re-read here via auth.getUser(), never trusted
 * from the client, so the "From:" line in the resulting email can't be
 * spoofed. Sends to feedback@wouldyouplease.com (the owner's own mailbox,
 * forwarded to his personal address) with Reply-To set to the tester's own
 * email, so a reply goes straight back to them.
 *
 * Image attachments (2026-11-22) — Jim: "add the ability to paste captured
 * images into the feedback email dialog." Sent as real nodemailer
 * attachments, never stored anywhere server-side — matching this route's
 * own existing "no stored record of a submission" design. The client
 * (useFeedbackImages.ts) already restricts to image/* and a 3-image/5 MB
 * cap via its own file picker/paste handler, but that's only ever a
 * courtesy; parseImageAttachment() re-enforces the same limits here.
 */

const FEEDBACK_TO_ADDRESS = 'feedback@wouldyouplease.com'
const SUBJECTS = ['Error', 'Something Awkward', 'Something Missing', 'Other']
const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

type IncomingImage = { filename?: unknown; contentType?: unknown; dataUrl?: unknown }

function parseImageAttachment(raw: IncomingImage, index: number) {
  if (typeof raw.dataUrl !== 'string' || typeof raw.contentType !== 'string') return null
  if (!raw.contentType.startsWith('image/')) return null
  const match = /^data:[^;]+;base64,(.+)$/.exec(raw.dataUrl)
  if (!match) return null
  const content = Buffer.from(match[1], 'base64')
  if (content.length === 0 || content.length > MAX_IMAGE_BYTES) return null
  const filename =
    typeof raw.filename === 'string' && raw.filename.trim() ? raw.filename.trim() : `screenshot-${index + 1}.png`
  return { filename, content, contentType: raw.contentType }
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
  let body: { subject?: string; body?: string; images?: IncomingImage[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ sent: false, reason: 'bad_request' }, { status: 400 })
  }

  const subject = SUBJECTS.includes(body.subject ?? '') ? (body.subject as string) : 'Other'
  const message = (body.body ?? '').trim()
  if (!message) {
    return Response.json({ sent: false, reason: 'bad_request' }, { status: 400 })
  }

  const rawImages = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : []
  const attachments = rawImages
    .map((img, i) => parseImageAttachment(img, i))
    .filter((a): a is NonNullable<ReturnType<typeof parseImageAttachment>> => a !== null)

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
  if (userError || !userData.user?.email) {
    return Response.json({ sent: false, reason: 'unauthenticated' }, { status: 401 })
  }
  const testerEmail = userData.user.email

  const transporter = getSmtpTransport()
  if (!transporter) {
    return Response.json({ sent: false, reason: 'not_configured' }, { status: 200 })
  }

  try {
    await transporter.sendMail({
      from: `"Would You Please Tester Feedback" <${EMAIL_FROM_ADDRESS}>`,
      to: FEEDBACK_TO_ADDRESS,
      replyTo: testerEmail,
      subject: `WYP Tester Feedback: ${subject} (from ${testerEmail})`,
      text: message,
      attachments: attachments.length > 0 ? attachments : undefined,
    })

    return Response.json({ sent: true }, { status: 200 })
  } catch (err) {
    return Response.json(
      { sent: false, reason: 'send_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 200 }
    )
  }
}
