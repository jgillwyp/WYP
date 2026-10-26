'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Capacitor } from '@capacitor/core'

import WypHeader from './WypHeader'
import AppFooter from './AppFooter'
import { isAndroidDevice, isIOSDevice, isMacOSDevice } from '@/lib/platform'

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
 */

type Group = 'start' | 'features' | 'quirks' | 'feedback'
type Platform = 'android' | 'ios' | 'mac' | 'windows'

type ChecklistItem = {
  id: string
  group: Group
  title: string
  detail: React.ReactNode
}

const PLATFORM_TITLE: Record<Platform, string> = {
  android: 'Android Tester Checklist',
  ios: 'iPhone Tester Checklist',
  mac: 'Mac Tester Checklist',
  windows: 'Windows Tester Checklist',
}

const PLATFORM_INTRO: Record<Platform, string> = {
  android:
    "Fourteen days, your phone, real Requests and ToDos. You're testing the installed Android app itself, not just the website.",
  ios: "Fourteen days, your iPhone, real Requests and ToDos. The dedicated iPhone app is still being built, so for now you're testing through Safari (or another browser) — from a regular tab, or from the Home Screen icon if you've added one.",
  mac: "Fourteen days, your Mac, real Requests and ToDos. You're testing through a browser, or the installed app if you've added it to your Dock.",
  windows:
    "Fourteen days, your PC, real Requests and ToDos. You're testing through a browser, or the installed desktop app if you've added its icon.",
}

const PLATFORM_INTRO_TAIL =
  " Work through this at your own pace — check off what you've tried as you go (your checkmarks stay on this device only). This list can change in a future app update, so check back."

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
    { id: 'feat-1', group: 'features', title: 'Create a Request', detail: "Add a Contact if you don't have one yet, then send them a Request with a Due Date and a Description." },
    { id: 'feat-2', group: 'features', title: 'Create a ToDo', detail: 'A ToDo is a Request to yourself — no Contact needed.' },
    { id: 'feat-3', group: 'features', title: 'Respond to a Request', detail: 'If someone sends you one, find it under Received and mark it Done.' },
    { id: 'feat-4', group: 'features', title: 'Add an Attachment', detail: 'A photo, PDF, or other file on a Request or ToDo.' },
    { id: 'feat-5', group: 'features', title: 'Try Voice Dictation', detail: 'Tap the microphone icon in a Description field and speak instead of typing.' },
    { id: 'feat-6', group: 'features', title: 'Set a Reminder', detail: 'On a Request with a Due Date, try Day Before / Day Of / Day After under Reminders.' },
    { id: 'feat-7', group: 'features', title: 'Try Repeat', detail: 'Set a Request or ToDo to repeat (e.g. weekly) and see the next one get created automatically.' },
    { id: 'feat-8', group: 'features', title: 'Look at Calendar View', detail: 'Your Requests and ToDos laid out by date.' },
    { id: 'feat-9', group: 'features', title: 'Archive something, then find it again', detail: 'Archive a finished item from Housekeeping, then locate it in Archive.' },
    {
      id: 'feat-10',
      group: 'features',
      title: 'Compare Free vs. Subscriber',
      detail: (
        <>
          Your account starts with Subscriber access so you can try everything. In <code>Account Options → Subscriber
          section</code>, uncheck <code>Subscribed? (testing only)</code> to see the Free experience, then check it
          again — worth trying both, since most real users will be on Free.
        </>
      ),
    },
    { id: 'quirk-1', group: 'quirks', title: '"Subscribe" won’t charge you', detail: "Real payment processing isn't connected yet — those buttons are safe to tap." },
    { id: 'quirk-2', group: 'quirks', title: 'First mic tap asks permission', detail: 'The first time you use Voice Dictation, you’ll be asked to allow microphone access — say yes, or dictation won’t work.' },
    { id: 'fb-1', group: 'feedback', title: 'Use Private Tester → Feedback', detail: 'Housekeeping → Private Tester → Feedback, from the Main Screen.' },
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
const STORAGE_KEY = 'wyp.testerChecklistChecked'

function loadChecked(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveChecked(map: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Private window or blocked storage — checkmarks just won't persist.
  }
}

export default function TesterChecklistForm() {
  const router = useRouter()
  const [platform, setPlatform] = useState<Platform>('windows')
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  // Platform-sensed title/content and localStorage checkmarks both read
  // client-only state — deferred one microtask past mount so the first
  // render (server and client alike) stays identical, same
  // react-hooks/set-state-in-effect-safe pattern as CreateRequestForm.tsx's
  // own voiceSupported.
  useEffect(() => {
    queueMicrotask(() => {
      setPlatform(detectPlatform())
      setChecked(loadChecked())
    })
  }, [])

  const items = buildItems(platform)
  const checkableTotal = items.filter((it) => it.group !== 'quirks').length
  const checkableDone = items.filter((it) => it.group !== 'quirks' && checked[it.id]).length

  function toggle(id: string) {
    const next = { ...checked, [id]: !checked[id] }
    setChecked(next)
    saveChecked(next)
  }

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
              {PLATFORM_INTRO[platform]}
              {PLATFORM_INTRO_TAIL}
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
                      <label key={it.id} className="checkrow">
                        <input type="checkbox" checked={!!checked[it.id]} onChange={() => toggle(it.id)} />
                        <div>
                          <span className="checktext">{it.title}</span>
                          <span className="checknote">{it.detail}</span>
                        </div>
                      </label>
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
