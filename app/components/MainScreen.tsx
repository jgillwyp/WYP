'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

/**
 * Main Screen (§6.7) — converted from
 * design/screens/WYP_main_screen_palette1.html for the first working landing
 * screen after sign-in ("I would like to see the WYP app retain the
 * device-login validation and be able to test it in a more normal way", 2026-08-08).
 *
 * Scope for this pass, confirmed with the owner via two rounds of questions:
 * - Sent and ToDos are LIVE — real `requests` rows, default sort pills
 *   working (Due ▼ descending for Sent, Priority ▼ ascending for ToDos).
 * - Received stays a placeholder. No schema/RLS path exists yet for a
 *   signed-in recipient to see a Request someone else sent them — `requests`
 *   RLS is owner-only (migration 003) and there is no column linking a row to
 *   its recipient's own account. Flagged, not solved, here.
 * - Search bar and the All/Open/Overdue/Done (Sent/Received) and
 *   All/Open/Done (ToDos) filter chips render but do nothing this pass —
 *   the owner's explicit choice ("Stay visual-only for now").
 * - Housekeeping's My Contacts / Your Account rows and the ToDos band's
 *   Create ToDo button are inert placeholders: none of `/contacts` (a list
 *   view), `/account`, or `/todos/new` exist as routes yet (see CLAUDE.md
 *   Known gaps). Log Out is real — it is the one piece that directly serves
 *   the "test the login loop normally" goal this screen was built for.
 *
 * Icons are inline SVG (currentColor, driven by .iconbtn/.ii's own color),
 * not the mockup's base64 PNGs — matches how every other screen in this app
 * was converted. Shapes are adapted from the canonical wyp_icon_*.svg source
 * (see design/README.md), except Print, which reuses the exact icon already
 * used on Create Request / Request Response for consistency with that
 * existing precedent rather than the asset-source printer glyph.
 */

type SentRow = {
  id: string
  description: string
  due_date: string | null
  done_date: string | null
  created_at: string
  contacts: { display_name: string } | null
  dialog: { count: number }[] | null
}

type TodoRow = {
  id: string
  description: string
  priority: number | null
  categories: { name: string } | null
  dialog: { count: number }[] | null
}

const PRIORITY_LABEL: Record<number, string> = { 1: 'ASAP', 2: 'SOON', 3: 'LATER' }

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// due_date/done_date/created_at all arrive as 'YYYY-MM-DD' (dates) or a full
// ISO timestamp (created_at) — slicing to the first 10 characters handles
// both before splitting, matching the app-wide MM-DD-YY display convention.
function formatMDY(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${m}-${d}-${y.slice(2)}`
}

function sentStatus(r: SentRow): 'open' | 'overdue' | 'done' {
  if (r.done_date) return 'done'
  if (r.due_date && r.due_date < todayIso()) return 'overdue'
  return 'open'
}

function dialogCount(dialog: { count: number }[] | null): number {
  return dialog?.[0]?.count ?? 0
}

function DialogIcon() {
  return (
    <svg className="iico" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <title>Dialog present</title>
      <path
        d="M23,6 H37 A5,5 0 0 1 42,11 V19 A5,5 0 0 1 37,24 H30 L36,31 L28,24 H23 A5,5 0 0 1 18,19 V11 A5,5 0 0 1 23,6 Z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M11,20 H25 A5,5 0 0 1 30,25 V33 A5,5 0 0 1 25,38 H17 L10,44 L13,38 H11 A5,5 0 0 1 6,33 V25 A5,5 0 0 1 11,20 Z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="8" y="8" width="32" height="32" rx="5" stroke="currentColor" strokeWidth="2.5" />
      <line x1="24" y1="24" x2="32" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <polyline points="26,16 32,16 32,22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="24" y1="24" x2="16" y2="32" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <polyline points="22,32 16,32 16,26" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M7 8V3h10v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="8" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M7 14h10v7H7v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="17" cy="11" r="1" fill="currentColor" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="2.5" />
      <line x1="30" y1="30" x2="44" y2="44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function VoiceSearchIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="16" y="4" width="16" height="24" rx="8" stroke="currentColor" strokeWidth="2.5" />
      <path d="M10,24 Q10,36 24,36 Q38,36 38,24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <line x1="24" y1="36" x2="24" y2="44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="16" y1="44" x2="32" y2="44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export default function MainScreen() {
  const router = useRouter()

  const [sent, setSent] = useState<SentRow[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hkTab, setHkTab] = useState<'tasks' | 'videos'>('tasks')
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const [sentRes, todoRes] = await Promise.all([
        supabase
          .from('requests')
          .select('id, description, due_date, done_date, created_at, contacts(display_name), dialog(count)')
          .not('contact_id', 'is', null)
          .order('due_date', { ascending: false, nullsFirst: false }),
        supabase
          .from('requests')
          .select('id, description, priority, categories(name), dialog(count)')
          .is('contact_id', null)
          .order('priority', { ascending: true, nullsFirst: false }),
      ])

      if (cancelled) return

      if (sentRes.error || todoRes.error) {
        setLoadError((sentRes.error ?? todoRes.error)?.message ?? 'Could not load requests.')
      } else {
        setSent((sentRes.data as unknown as SentRow[]) ?? [])
        setTodos((todoRes.data as unknown as TodoRow[]) ?? [])
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="scroll">
          {/* ---------------------------------------------------------- Requests */}
          <div className="band">
            <span className="glabel">Requests</span>
            <Link className="btn" href="/requests/new">Create&nbsp;Request</Link>
          </div>

          {/* Sent — live */}
          <div className="subcard">
            <div className="subhead">
              <div className="subhead-top">
                <span className="subname">Sent</span>
                <span className="subicons">
                  <span className="iconbtn" role="button" tabIndex={0} aria-label="Expand Sent"><ExpandIcon /></span>
                  <span className="iconbtn" role="button" tabIndex={0} aria-label="Print Sent"><PrintIcon /></span>
                </span>
              </div>
              <div className="chips">
                <span className="chip sel">All</span>
                <span className="chip">Open</span>
                <span className="chip over">Overdue</span>
                <span className="chip done">Done</span>
              </div>
            </div>
            <div className="subbody">
              <div className="colbar sr">
                <span className="c-nm">To</span>
                <span className="c-dt">Date</span>
                <span className="c-due"><span className="pill">Due&nbsp;▼</span></span>
                <span className="c-dn">Done</span>
              </div>
              <div className="rows">
                {loading && <div className="subempty">Loading…</div>}
                {!loading && loadError && <div className="subempty">{loadError}</div>}
                {!loading && !loadError && sent.length === 0 && (
                  <div className="subempty">No Sent Requests yet.</div>
                )}
                {!loading && !loadError && sent.map((r) => {
                  const status = sentStatus(r)
                  const late = status === 'done' && !!r.due_date && !!r.done_date && r.done_date > r.due_date
                  return (
                    <div key={r.id} className={`row${status === 'overdue' ? ' overdue' : ''}${status === 'done' ? ' done' : ''}`}>
                      <div className="r1">
                        <span className="nm">{r.contacts?.display_name ?? '—'}</span>
                        <span className="dt">{formatMDY(r.created_at)}</span>
                        <span className="due">{formatMDY(r.due_date)}</span>
                        <span className={`dn${late ? ' late' : ''}`}>{formatMDY(r.done_date)}</span>
                      </div>
                      <div className="r2">
                        {dialogCount(r.dialog) > 0 && (
                          <span className="ii"><DialogIcon /></span>
                        )}
                        <span className="desc">{r.description}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Received — deferred, see file header comment */}
          <div className="subcard">
            <div className="subhead">
              <div className="subhead-top">
                <span className="subname">Received</span>
                <span className="subicons">
                  <span className="iconbtn" role="button" tabIndex={0} aria-label="Expand Received"><ExpandIcon /></span>
                  <span className="iconbtn" role="button" tabIndex={0} aria-label="Print Received"><PrintIcon /></span>
                </span>
              </div>
              <div className="chips">
                <span className="chip sel">All</span>
                <span className="chip">Open</span>
                <span className="chip over">Overdue</span>
                <span className="chip done">Done</span>
              </div>
            </div>
            <div className="subbody">
              <div className="colbar sr">
                <span className="c-nm">From</span>
                <span className="c-dt">Date</span>
                <span className="c-due"><span className="pill">Due&nbsp;▼</span></span>
                <span className="c-dn">Done</span>
              </div>
              <div className="subempty">
                Receiving Requests from other Would You Please users isn&rsquo;t built yet.
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------- ToDos */}
          <div className="band">
            <span className="glabel">ToDos</span>
            <button className="btn" type="button">Create&nbsp;ToDo</button>
          </div>

          <div className="subcard">
            <div className="subhead todos-head">
              <div className="chips">
                <span className="chip">All</span>
                <span className="chip sel">Open</span>
                <span className="chip done">Done</span>
              </div>
              <span className="subicons">
                <span className="iconbtn" role="button" tabIndex={0} aria-label="Expand ToDos"><ExpandIcon /></span>
                <span className="iconbtn" role="button" tabIndex={0} aria-label="Print ToDos"><PrintIcon /></span>
              </span>
            </div>
            <div className="subbody">
              <div className="colbar td">
                <span className="c-pri"><span className="pill">Priority&nbsp;▼</span></span>
                <span className="c-cat">Category — Description</span>
              </div>
              <div className="rows">
                {loading && <div className="subempty">Loading…</div>}
                {!loading && loadError && <div className="subempty">{loadError}</div>}
                {!loading && !loadError && todos.length === 0 && (
                  <div className="subempty">No ToDos yet.</div>
                )}
                {!loading && !loadError && todos.map((t) => (
                  <div key={t.id} className="row td">
                    <div className="t1">
                      {dialogCount(t.dialog) > 0 && (
                        <span className="ii"><DialogIcon /></span>
                      )}
                      <span className="tdc">
                        <span className="pri">{t.priority ? PRIORITY_LABEL[t.priority] : ''}</span>{' '}
                        <span className="cat">{t.categories?.name ?? '—'}</span> — <span className="tdd">{t.description}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------- Housekeeping */}
          <div className="band">
            <span className="glabel">Housekeeping</span>
            <button className="btn-quiet" type="button" onClick={handleLogOut} disabled={signingOut}>
              {signingOut ? 'Logging out…' : 'Log Out'}
            </button>
          </div>

          <div className="subcard">
            <div className="subhead hk-head">
              <div className="subhead-top">
                <div className="chips" role="tablist" aria-label="Housekeeping section">
                  <button
                    className={`chip${hkTab === 'tasks' ? ' sel' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={hkTab === 'tasks'}
                    onClick={() => setHkTab('tasks')}
                  >
                    Tasks
                  </button>
                  <button
                    className={`chip${hkTab === 'videos' ? ' sel' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={hkTab === 'videos'}
                    onClick={() => setHkTab('videos')}
                  >
                    How-to Videos
                  </button>
                </div>
              </div>
            </div>
            {hkTab === 'tasks' ? (
              <div className="subbody">
                <div className="hkrows">
                  <div className="hkrow" role="button" tabIndex={0}>
                    <span className="hktext">
                      <span className="hktitle">My Contacts</span>
                      <span className="hknote"> — view and edit</span>
                    </span>
                  </div>
                  <div className="hkrow" role="button" tabIndex={0}>
                    <span className="hktext">
                      <span className="hktitle">Your Account</span>
                      <span className="hknote"> — view and edit</span>
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="subbody">
                <div className="hkrows">
                  <div className="hkrow" role="button" tabIndex={0}>
                    <span className="hktext">
                      <span className="hktitle">Getting Started</span>
                      <span className="hknote"> — placeholder, no video linked yet</span>
                    </span>
                  </div>
                  <div className="hkrow" role="button" tabIndex={0}>
                    <span className="hktext">
                      <span className="hktitle">Creating a Request</span>
                      <span className="hknote"> — placeholder, no video linked yet</span>
                    </span>
                  </div>
                  <div className="hkrow" role="button" tabIndex={0}>
                    <span className="hktext">
                      <span className="hktitle">Responding to a Request</span>
                      <span className="hknote"> — placeholder, no video linked yet</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="scroll-pad" />
        </div>

        {/* Search bar — visual only this pass, see file header comment */}
        <div className="searchbar sb">
          <button className="scope" type="button">All&nbsp;▼</button>
          <input className="field" type="text" placeholder="Search Would You Please" readOnly />
          <span className="iconbtn" role="button" tabIndex={0} aria-label="Voice search"><VoiceSearchIcon /></span>
          <span className="iconbtn" role="button" tabIndex={0} aria-label="Search"><SearchIcon /></span>
        </div>
        <div className="subbanner" role="button" tabIndex={0}>See Subscription Features and Other Options</div>
        <div className="adslot" aria-hidden="true"><span className="adbox">AD — 320×50 RESERVED</span></div>
      </div>
    </div>
  )
}
