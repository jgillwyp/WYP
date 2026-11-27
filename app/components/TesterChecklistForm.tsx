'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Capacitor } from '@capacitor/core'

import WypHeader from './WypHeader'
import AppFooter from './AppFooter'
import { isAndroidDevice, isIOSDevice, isMacOSDevice } from '@/lib/platform'
import { supabase } from '@/lib/supabaseClient'
import { readLocalChecklistMarks } from '@/lib/featureUsage'
import type { LocalChecklistMark, TrackedFeature } from '@/lib/featureUsage'

/**
 * Private Tester Checklist (2026-10-26) — supersedes the claude.ai Artifact
 * version (published 2026-10-21) outright. Jim: he wants the
 * localStorage-personal-checkmarks/shared-content-read-only split that
 * Artifact already had, but without requiring testers to sign into any
 * Claude.ai account at all — and the Artifact's own `db` capability
 * genuinely can't do that: a fully signed-out visitor gets no shared data
 * from it ("A signed-out visitor has no data at all," per the capability's
 * own access rules), which would have blocked exactly the testers this
 * screen is for. Moving the content in-app instead sidesteps the problem
 * entirely — testers already have a real WYP sign-in to test the app with,
 * so this is just another `RequireAuth` screen, reached from the same
 * Housekeeping "Private Tester" menu as Feedback. The list itself is now
 * baked into the app bundle rather than live-editable without a redeploy —
 * an accepted trade-off for not needing a Claude.ai account at all.
 *
 * Reached only from MainScreen.tsx's Housekeeping "Private Tester" menu,
 * same as Help topics; `router.back()` for Close, matching every other
 * Housekeeping-reached screen (Archive/Contacts/Private Categories/
 * Storage Management) rather than HelpTopicShell's own `push('/')` — this
 * isn't a chained "what to try next" flow, just a single destination.
 *
 * Fully automatic (2026-11-27) — Jim: "To make this really easy, we keep
 * track of what features you have used and mark them accordingly... Maybe
 * show the checkboxes for the 17 features checked or unchecked as
 * appropriate but as disabled checkboxes." Every checkbox is now disabled;
 * nothing is tapped by hand. Each row is checked from one of two sources:
 * the account's own feature_usage rows (get_my_feature_usage(), the 13
 * features in FEATURE_ITEM_ID) or a device-local marker
 * (featureUsage.ts's readLocalChecklistMarks(), LOCAL_MARK_ITEM_IDS) for the
 * few rows feature_usage doesn't cover — Jim was fine with those staying in
 * the browser. The old manual-checkmark localStorage key
 * (wyp.testerChecklistChecked) is no longer read: a hand-ticked box from
 * before this change can't be told apart from real usage.
 */

type Group = 'start' | 'features' | 'quirks' | 'feedback'
type Platform = 'android' | 'ios' | 'mac' | 'windows'

type ChecklistItem = {
  id: string
  group: Group
  title: string
  detail: React.ReactNode
  // Feature-usage tracking (2026-11-23, migration 103) — set only on an
  // item that a real app action can confirm automatically; see
  // featureUsage.ts's own header comment and FEATURE_ITEM_ID below.
  autoFeature?: TrackedFeature
  // Subscription indication (2026-11-23) — Jim: "There should be an
  // indication of which activities require a Subscription." Scoped to
  // just the items that are genuinely gated on tier === 'subscriber'
  // (Voice Dictation, Receipt Confirmation, Request Texting) — not the
  // free-tier-available-with-caps ones (Attachments, Repeat), which don't
  // actually require anything. Renders the existing .checkword badge
  // (same component Account Options' own squint-test prefixes use) after
  // the title.
  requiresSubscription?: boolean
}

// The reverse of a ChecklistItem's own autoFeature — built once here,
// independent of buildItems()/platform, since every auto-detectable item
// in this file so far is pushed unconditionally regardless of platform.
// Until 2026-11-27 only dialog_entry was mapped here, even though migration
// 104 had already started logging all 13 — the rest never auto-checked.
const FEATURE_ITEM_ID: Record<TrackedFeature, string> = {
  request_created: 'feat-1',
  todo_created: 'feat-2',
  request_responded: 'feat-3',
  dialog_entry: 'feat-dialog',
  attachment_added: 'feat-4',
  voice_dictation: 'feat-5',
  receipt_confirmation: 'feat-receipt',
  request_texting: 'feat-texting',
  reminder_set: 'feat-6',
  repeat_set: 'feat-7',
  calendar_view: 'feat-8',
  archive_used: 'feat-9',
  print_used: 'feat-9b',
}

// Rows with no feature_usage counterpart, checked from this device's own
// localStorage markers instead. One sent Feedback covers all three "How to
// report something" rows — they describe the steps of a single send.
const LOCAL_MARK_ITEM_IDS: Record<LocalChecklistMark, string[]> = {
  feedback_sent: ['fb-1', 'fb-2', 'fb-3'],
  tier_toggled: ['feat-10'],
  link_opened_app: ['start-2'],
}

const PLATFORM_TITLE: Record<Platform, string> = {
  android: 'Android Tester Checklist',
  ios: 'iPhone Tester Checklist',
  mac: 'Mac Tester Checklist',
  windows: 'Windows Tester Checklist',
}

// "Fourteen days" dropped from every intro, 2026-11-08 — owner-reported:
// "Android testers are not all part of the '14 days' - that is yet to be
// started - but there are Android testers... similarly for iPhone
// testers - there is no 14 day strategy with Apple for testing... also
// for Windows, there is no 14 day strategy for testing." The literal
// 12-tester/14-day window is a Google Play closed-testing *track*
// requirement (see MainScreen.tsx's own Feedback-dialog comment) — real
// for Android specifically, but not yet the track these current Android
// testers are actually on (they're on the direct-APK-sideload path, see
// app/android/page.tsx), and never applicable to iOS/Mac/Windows at all.
// Any platform-specific duration/instructions belong in whatever channel
// recruits that round of testers (an email, or the testing organization's
// own instructions to its participants), not hardcoded into this screen.
//
// Per-platform intro sentences dropped entirely (2026-11-27) — Jim replaced
// the whole intro with one platform-neutral paragraph; only the title above
// still names the platform.
const CHECKLIST_INTRO =
  'Work through this at your own pace. To make this really easy, we keep track of what features you have used and mark them accordingly. This list can change in app updates, so please check back.'

function detectPlatform(): Platform {
  if (Capacitor.isNativePlatform()) {
    const native = Capacitor.getPlatform()
    if (native === 'android') return 'android'
    if (native === 'ios') return 'ios'
  }
  if (isIOSDevice()) return 'ios'
  if (isAndroidDevice()) return 'android'
  if (isMacOSDevice()) return 'mac'
  return 'windows'
}

function buildItems(platform: Platform): ChecklistItem[] {
  // No "Sign in" item here (2026-10-26, owner-reported) — this screen is
  // RequireAuth-wrapped, so reaching it at all already means the tester is
  // signed in; walking them through signing in again would be redundant.
  const items: ChecklistItem[] = []

  if (platform === 'android') {
    items.push({
      id: 'start-2',
      group: 'start',
      title: 'Confirm links open the app',
      detail: 'Tapping a wouldyouplease.com link, from an email or a text, should open this app directly rather than your browser. If you use Outlook for email and it still opens a separate Outlook browser view, go to Outlook’s Settings (gear) → Preferences → turn on Use Default Browser.',
    })
  }

  items.push(
    {
      id: 'feat-1',
      group: 'features',
      title: 'Create a Request',
      detail:
        "Add a Contact if you don't have one yet, then send them a Request with a Due Date and a Description. You can add yourself as a contact to easily see both creating and receiving Requests.",
    },
    {
      id: 'feat-2',
      group: 'features',
      title: 'Create a ToDo',
      detail:
        'A ToDo is a Request to yourself — no Contact needed. Dialogs work for both Requests and ToDos. For ToDos, they offer an ability to enter date-stamped progress history.',
    },
    {
      id: 'feat-3',
      group: 'features',
      title: 'Respond to a Request you send to yourself',
      detail:
        'Find it under Received and mark it Done. This provides you with a full view of the whole Request/Response process.',
    },
    {
      id: 'feat-dialog',
      group: 'features',
      title: 'Add a Dialog entry',
      detail: 'Open a Request or ToDo and add a Question, Answer, or Comment under Dialog.',
      autoFeature: 'dialog_entry',
    },
    { id: 'feat-4', group: 'features', title: 'Add an Attachment', detail: 'A photo, PDF, or other file on a Request or ToDo.' },
    {
      id: 'feat-5',
      group: 'features',
      title: 'Try Voice Dictation',
      detail: 'Tap the microphone icon in a Description field and speak instead of typing.',
      requiresSubscription: true,
    },
    {
      id: 'feat-receipt',
      group: 'features',
      title: 'Try Receipt Confirmation',
      detail:
        "In Account Options → Requests (sent), turn on \"Show optional Receipt Confirmation,\" then check it on a new Request. Opening the Request's own link — from the email or a text — confirms receipt automatically.",
      requiresSubscription: true,
    },
    {
      id: 'feat-texting',
      group: 'features',
      title: 'Try Request Texting',
      detail:
        'On a Contact, choose Text instead of Email as the send method. Saving emails that Contact a link to approve text messaging — no real text goes out until they approve.',
      requiresSubscription: true,
    },
    {
      id: 'feat-6',
      group: 'features',
      title: 'Set a Reminder',
      detail: 'On a Request with a Due Date, try Day Before / Day Of / Minutes Before / Day After under Reminders.',
    },
    { id: 'feat-7', group: 'features', title: 'Try Repeat', detail: 'Set a Request or ToDo to repeat (e.g. weekly) and see the next one get created automatically.' },
    { id: 'feat-8', group: 'features', title: 'Look at Calendar View', detail: 'Your Requests and ToDos laid out by date.' },
    { id: 'feat-9', group: 'features', title: 'Archive something, then find it again', detail: 'Archive a finished item from Housekeeping, then locate it in Archive.' },
    {
      id: 'feat-9b',
      group: 'features',
      title: 'Print something',
      detail: 'All detail screens and lists can be printed. If you are not connected to a printer, select PDF to see the printout.',
    },
    {
      id: 'feat-10',
      group: 'features',
      title: 'Compare Free vs. Subscriber',
      detail: (
        <>
          In <code>Account Options → Account Status</code>, use the testing-only switch to move between Free and
          Subscriber — worth trying both, since most real users will be on Free.
        </>
      ),
    },
    { id: 'quirk-1', group: 'quirks', title: '"Subscribe" won’t charge you', detail: 'Payments run in Stripe test mode during Pre-Release Testing, so nothing is ever charged. To try a sign-up, use the test card 4242 4242 4242 4242 (the other card values can be made-up).' },
    { id: 'quirk-2', group: 'quirks', title: 'First mic tap asks permission', detail: 'The first time you use Voice Dictation, you’ll be asked to allow microphone access — say yes, or dictation won’t work.' },
    { id: 'fb-1', group: 'feedback', title: 'Use Pre-Release Tester → Feedback', detail: 'Housekeeping → Pre-Release Tester → Feedback, from the Main Screen.' },
    { id: 'fb-2', group: 'feedback', title: 'Pick a Subject', detail: 'Error, Something Awkward, Something Missing, or Other.' },
    { id: 'fb-3', group: 'feedback', title: 'Say what happened and what you expected', detail: 'It goes straight to Jim by email, with a reply-to address back to you.' }
  )

  if (platform === 'android') {
    items.push({
      id: 'quirk-3',
      group: 'quirks',
      title: 'Outlook opens its own in-app browser',
      detail: 'Outlook keeps links inside its own viewer by default. Fix: Outlook app → Settings (gear) → Preferences → turn on Use Default Browser.',
    })
  }

  return items
}

const GROUP_LABEL: Record<Group, string> = {
  start: 'Before you start',
  features: 'Features worth trying',
  quirks: "Known quirks — not bugs",
  feedback: 'How to report something',
}

const GROUP_ORDER: Group[] = ['start', 'features', 'quirks', 'feedback']

export default function TesterChecklistForm() {
  const router = useRouter()
  const [platform, setPlatform] = useState<Platform>('windows')
  // Item ids confirmed by real usage — the union of the account's own
  // feature_usage rows and this device's local markers (see the header
  // comment). There is no manual checking any more.
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  // Platform-sensed title/content and localStorage markers both read
  // client-only state — deferred one microtask past mount so the first
  // render (server and client alike) stays identical, same
  // react-hooks/set-state-in-effect-safe pattern as CreateRequestForm.tsx's
  // own voiceSupported.
  useEffect(() => {
    queueMicrotask(() => {
      setPlatform(detectPlatform())
      const local: Record<string, boolean> = {}
      for (const mark of readLocalChecklistMarks()) {
        for (const itemId of LOCAL_MARK_ITEM_IDS[mark] ?? []) local[itemId] = true
      }
      setChecked((current) => ({ ...current, ...local }))
    })
  }, [])

  // Separate effect (a real network call, not just client-only state) —
  // runs once on mount; this screen is RequireAuth-wrapped, so a session
  // always exists.
  useEffect(() => {
    let cancelled = false
    async function loadDetected() {
      const { data, error } = await supabase.rpc('get_my_feature_usage')
      if (cancelled || error || !Array.isArray(data)) return
      const seen = new Set((data as { feature: string }[]).map((row) => row.feature))
      const next: Record<string, boolean> = {}
      for (const [feature, itemId] of Object.entries(FEATURE_ITEM_ID) as [TrackedFeature, string][]) {
        if (seen.has(feature)) next[itemId] = true
      }
      if (Object.keys(next).length === 0) return
      setChecked((current) => ({ ...current, ...next }))
    }
    void loadDetected()
    return () => {
      cancelled = true
    }
  }, [])

  const items = buildItems(platform)
  const checkableTotal = items.filter((it) => it.group !== 'quirks').length
  const checkableDone = items.filter((it) => it.group !== 'quirks' && checked[it.id]).length

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">{PLATFORM_TITLE[platform]}</span>
          <button className="btn" type="button" onClick={() => router.back()}>
            Close
          </button>
        </div>

        <div className="scroll">
          <div style={{ padding: '14px var(--pad) 6px' }}>
            <p className="help-lead" style={{ marginBottom: 16 }}>
              {CHECKLIST_INTRO}
            </p>

            <div className="metarow" style={{ marginBottom: 18 }}>
              <b>Progress:</b>
              <span>
                {checkableDone} of {checkableTotal}
              </span>
            </div>

            {GROUP_ORDER.map((group) => {
              const rows = items.filter((it) => it.group === group)
              if (!rows.length) return null
              return (
                <div key={group} style={{ marginBottom: 22 }}>
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--brand-blue)',
                      margin: '0 0 10px',
                    }}
                  >
                    {GROUP_LABEL[group]}
                  </p>
                  {group === 'quirks' && (
                    <p className="checknote" style={{ marginBottom: 10 }}>
                      These are expected — no need to report them.
                    </p>
                  )}
                  {rows.map((it) =>
                    group === 'quirks' ? (
                      <div key={it.id} className="checkrow" style={{ cursor: 'default' }}>
                        <div>
                          <span className="checktext">{it.title}</span>
                          <span className="checknote">{it.detail}</span>
                        </div>
                      </div>
                    ) : (
                      <div key={it.id} className="checkrow" style={{ cursor: 'default' }}>
                        <input
                          type="checkbox"
                          checked={!!checked[it.id]}
                          disabled
                          readOnly
                          aria-label={checked[it.id] ? 'Used' : 'Not yet used'}
                        />
                        <div>
                          <span className="checktext">
                            {it.title}
                            {it.requiresSubscription && <span className="checkword"> — Subscriber feature</span>}
                          </span>
                          <span className="checknote">{it.detail}</span>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <AppFooter />
      </div>
    </div>
  )
}
