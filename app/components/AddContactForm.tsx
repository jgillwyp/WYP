'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { detectBrowserTimeZone, getAllTimeZones } from '@/lib/timeZones'

/**
 * Add Contact (§9.x) — converted by hand from
 * design/screens/WYP_add_contact_palette1_floating.html.
 *
 * THE SHIFT FROM VB6: in the mockup, and in a VB6 form, a field's value is a
 * property you set — Text1.Text = "". Here every field's value lives in one
 * place, the `form` state below, and the <input> is "controlled": its value
 * prop always equals form.firstName, and its onChange writes the keystroke
 * back into state. Nothing in this file ever reaches into the DOM and sets a
 * textbox's contents directly. React re-renders whatever JSX this function
 * returns every time state changes, and it diffs that against what's on
 * screen — so "update state" and "the screen is now correct" are the same
 * action. See docs/Week1_Add_Contact_React_Conversion.md for the full
 * walkthrough.
 *
 * Time Zone (Week 3, migration 007): a required §6.16 lookup field, same
 * shape as Category elsewhere — a text input filtered against a known list,
 * with a `selectedTimeZone` guard so Save can't succeed on typed text that
 * doesn't match a real zone. The list itself is every IANA zone name
 * (app/src/lib/timeZones.ts). Defaults on mount to the owner's own
 * profiles.time_zone if set, else the browser's detected zone — and if it
 * had to fall back to the browser, that value is also written back to
 * profiles.time_zone. That write-back is a deliberate decision, not an
 * accident: profiles.time_zone has nowhere else to come from yet (Create
 * Free Account and Account aren't part of the live sign-in flow — see
 * CLAUDE.md), so without it the owner's own zone would never settle into a
 * stored value at all. See decisions log if this should be reconsidered
 * once a real Account screen exists.
 *
 * Browse-on-focus bug (2026-08-09, owner-reported): because this field
 * always arrives pre-filled with a real, non-empty value (unlike Category,
 * which starts blank), the original filter — "show all zones only when the
 * query is empty" — meant focusing the field filtered the dropdown against
 * the already-selected zone's own name, so only that one zone ever showed.
 * Fixed with a `timeZoneBrowsing` flag: focus always shows the complete
 * list regardless of what's currently in the box, and the flag drops the
 * moment the user types a character, at which point filtering takes over
 * from what they've typed. The text is also selected on focus so the first
 * keystroke replaces the prefilled value rather than appending to it.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// See CreateRequestForm.tsx's identical constant for the full reasoning
// (globals.css's ftextarea-plain/.charcount comment; owner request
// 2026-08-16).
const NOTES_MAX = 500

type ContactFormState = {
  name: string
  email: string
  phone: string
  phoneExt: string
  notes: string
  timeZone: string
}

const initialState: ContactFormState = {
  name: '',
  email: '',
  phone: '',
  phoneExt: '',
  notes: '',
  timeZone: '',
}

export default function AddContactForm() {
  const router = useRouter()

  const [form, setForm] = useState<ContactFormState>(initialState)

  // send_by is fixed to 'email' for now — Text delivery isn't built (SMS/10DLC
  // is deferred per CLAUDE.md scope discipline), so the Text chip below is
  // locked outright rather than gated on profiles.tier. Kept as state, not a
  // plain constant, so the day this unlocks the chip needs a click handler
  // and a second value, not a rewrite of how the chip reads its own state.
  const [sendBy] = useState<'email'>('email')

  const [nameInvalid, setNameInvalid] = useState(false)
  const [emailInvalid, setEmailInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [timeZones] = useState<string[]>(() => getAllTimeZones())
  const [selectedTimeZone, setSelectedTimeZone] = useState<string | null>(null)
  const [showTimeZoneResults, setShowTimeZoneResults] = useState(false)
  const [timeZoneInvalid, setTimeZoneInvalid] = useState(false)
  // True from focus until the user types a character — see file-header
  // comment. Focus always browses the full list; typing switches to filtering.
  const [timeZoneBrowsing, setTimeZoneBrowsing] = useState(false)

  // tier — 2026-08-25, gates .adslot below (see that render site's own
  // comment). Piggybacks on the Time Zone effect's own unconditional
  // `profiles` fetch rather than a second query, unlike Contact Detail's
  // equivalent fix — that file's own `profiles` select only runs in a rare
  // fallback branch, this one always runs.
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')

  // Default Time Zone on mount — see the file-header comment for the
  // profiles.time_zone / browser-detection / write-back reasoning.
  useEffect(() => {
    let cancelled = false

    async function loadDefaultTimeZone() {
      const { data } = await supabase.from('profiles').select('time_zone, tier').single()
      if (cancelled) return

      setTier(data?.tier === 'subscriber' ? 'subscriber' : 'free')

      if (data?.time_zone) {
        setForm((f) => ({ ...f, timeZone: data.time_zone as string }))
        setSelectedTimeZone(data.time_zone as string)
        return
      }

      const browserZone = detectBrowserTimeZone()
      setForm((f) => ({ ...f, timeZone: browserZone }))
      setSelectedTimeZone(browserZone)

      const { data: userData } = await supabase.auth.getUser()
      if (!cancelled && userData.user) {
        await supabase.from('profiles').update({ time_zone: browserZone }).eq('id', userData.user.id)
      }
    }

    loadDefaultTimeZone()
    return () => {
      cancelled = true
    }
  }, [])

  function set<K extends keyof ContactFormState>(key: K, value: ContactFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const timeZoneQueryEmpty = form.timeZone.trim() === ''

  const filteredTimeZones = timeZoneBrowsing || timeZoneQueryEmpty
    ? timeZones
    : timeZones.filter((z) => z.toLowerCase().includes(form.timeZone.trim().toLowerCase()))

  function selectTimeZone(z: string) {
    setSelectedTimeZone(z)
    set('timeZone', z)
    setShowTimeZoneResults(false)
    setTimeZoneInvalid(false)
  }

  function validate(): boolean {
    const hasName = form.name.trim() !== ''
    const hasEmail = EMAIL_RE.test(form.email.trim())
    const hasTimeZone = selectedTimeZone !== null

    setNameInvalid(!hasName)
    setEmailInvalid(!hasEmail)
    setTimeZoneInvalid(!hasTimeZone)

    return hasName && hasEmail && hasTimeZone
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!validate()) return

    setSaving(true)

    // owner_id is set here so the row is populated correctly; it is NOT the
    // security check. The "contacts: owners select/update/delete own" and
    // "Allow individual insert" policies (docs/migrations/002_..., SQL
    // history) enforce owner_id = auth.uid() at the database regardless of
    // what this line sends. If this were wrong, or omitted, Postgres rejects
    // the insert — there is no "is this my data" branch to write in TSX.
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      setError('Your session has expired. Sign in again and retry.')
      setSaving(false)
      return
    }

    // first_name/last_name are not written here (2026-08-07 decision,
    // migration 005) — the columns stay in the table for possible later use,
    // but this app writes only display_name going forward. .select().single()
    // added 2026-08-11 (was a bare insert before) — the create-request return
    // path below needs the new row's own id to select it back there.
    const { data: inserted, error: insertError } = await supabase
      .from('contacts')
      .insert({
        owner_id: userData.user.id,
        display_name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        phone_ext: form.phoneExt.trim() || null,
        send_by: sendBy,
        notes: form.notes.trim() || null,
        time_zone: selectedTimeZone,
      })
      .select('id')
      .single()

    setSaving(false)

    if (insertError || !inserted) {
      setError(insertError?.message ?? 'Could not save the contact.')
      return
    }

    // Return destination depends on where this screen was opened from
    // (2026-08-11) — this file's own comment used to flag Create Request's
    // no-contact interception (§6.24, still not built) as the next entry
    // point that would need its own destination; that entry point arrived
    // first, via the plain "Add Contact" button, not the not-yet-built
    // dialog. ?from=create-request (set by CreateRequestForm.tsx's Add
    // Contact button) means Save should land back on Create Request with
    // the new contact selected, not on the Contacts list. Read via
    // window.location.search, not useSearchParams() — this runs inside an
    // event handler, already client-side only, so there's no SSR/Suspense
    // concern to avoid by using the hook instead.
    const from = new URLSearchParams(window.location.search).get('from')
    if (from === 'create-request') {
      router.push(`/requests/new?newContactId=${inserted.id}`)
    } else {
      router.push('/contacts')
    }
  }

  function handleCancel() {
    // Same origin-aware return as Save above, minus the new-contact id —
    // Cancel means nothing was added, so Create Request has nothing new to
    // select, but the owner should still land back there, not on the
    // Contacts list they never asked to see.
    const from = new URLSearchParams(window.location.search).get('from')
    router.push(from === 'create-request' ? '/requests/new' : '/contacts')
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">Add Contact</span>
          <span className="bandcluster">
            <button
              className="btn"
              type="submit"
              form="add-contact-form"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn-secondary"
              type="button"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </button>
          </span>
        </div>

        <div className="scroll">
          <form
            className="form"
            id="add-contact-form"
            onSubmit={handleSubmit}
            noValidate
          >
            <div className={`fgroup ffloat${nameInvalid ? ' is-invalid' : ''}`}>
              <input
                className="finput req"
                id="nm"
                type="text"
                autoComplete="name"
                placeholder=" "
                value={form.name}
                onChange={(e) => {
                  set('name', e.target.value)
                  if (nameInvalid) setNameInvalid(false)
                }}
              />
              <label className="flabel" htmlFor="nm">
                Name
              </label>
              {nameInvalid && <p className="ferror">Enter a Name.</p>}
            </div>

            <div className={`fgroup ffloat${emailInvalid ? ' is-invalid' : ''}`}>
              <input
                className="finput req"
                id="em"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder=" "
                value={form.email}
                onChange={(e) => {
                  set('email', e.target.value)
                  if (emailInvalid) setEmailInvalid(false)
                }}
                aria-invalid={emailInvalid}
                aria-describedby={emailInvalid ? 'em-error' : undefined}
              />
              <label className="flabel" htmlFor="em">
                Email
              </label>
              {emailInvalid && (
                <p className="ferror" id="em-error">
                  Enter a valid email address.
                </p>
              )}
            </div>

            <div className="fgroup">
              <div className="phone-row">
                {/* Country-code picker isn't wired yet — one fixed value, no
                    dropdown. See CLAUDE.md Known gaps. */}
                <button
                  className="ccode opt"
                  type="button"
                  aria-label="Country code, United States, +1"
                >
                  US&nbsp;+1 <span className="caret">&#9662;</span>
                </button>
                <span
                  className="ffloat"
                  style={{ flex: '1 1 auto', minWidth: 0, display: 'block' }}
                >
                  {/* Row Tint while Email is the send-by channel (2026-08-07)
                      — Phone genuinely isn't needed yet, since Text is
                      locked and Email is the only way a Request actually
                      sends. Goes white the moment sendBy is 'text', the same
                      "required/actively used" treatment as everywhere else
                      §6.25 governs — Phone stops being skippable once it's
                      the delivery channel. Reads off sendBy, not a hardcoded
                      class, so this needs no further change the day Text
                      unlocks. */}
                  <input
                    className={`finput${sendBy === 'email' ? ' opt' : ''}`}
                    id="ph"
                    type="tel"
                    autoComplete="tel-national"
                    inputMode="tel"
                    placeholder=" "
                    value={form.phone}
                    onChange={(e) => set('phone', e.target.value)}
                  />
                  <label className="flabel" htmlFor="ph">
                    Phone
                  </label>
                </span>
                {/* Ext. (2026-08-18) — its own field, not appended to Phone.
                    E.164 (the normalized digits-only format an SMS provider
                    like Twilio requires) has no room for a post-connect
                    extension, so it was never possible to keep one inside
                    `phone` itself; new contacts.phone_ext column (migration
                    034). Narrow fixed width rather than flex:1 1 auto like
                    Phone — an extension is a handful of digits, not a full
                    field's worth of content. Row Tint follows the same
                    sendBy === 'email' rule as Phone: neither is required
                    until Text is the actual delivery channel. */}
                <span
                  className="ffloat"
                  style={{ flex: '0 0 84px', minWidth: 0, display: 'block' }}
                >
                  <input
                    className={`finput${sendBy === 'email' ? ' opt' : ''}`}
                    id="pext"
                    type="text"
                    autoComplete="off"
                    inputMode="numeric"
                    placeholder=" "
                    value={form.phoneExt}
                    onChange={(e) => set('phoneExt', e.target.value)}
                  />
                  <label className="flabel" htmlFor="pext">
                    Ext.
                  </label>
                </span>
              </div>
            </div>

            <div className="fgroup">
              <div className="frow" style={{ position: 'relative' }}>
                <span className="ffloat">
                  <input
                    className="finput req"
                    id="tz"
                    type="text"
                    autoComplete="off"
                    placeholder=" "
                    value={form.timeZone}
                    onChange={(e) => {
                      set('timeZone', e.target.value)
                      if (selectedTimeZone && e.target.value !== selectedTimeZone) {
                        setSelectedTimeZone(null)
                      }
                      setTimeZoneBrowsing(false)
                      setShowTimeZoneResults(true)
                    }}
                    onFocus={(e) => {
                      e.target.select()
                      setTimeZoneBrowsing(true)
                      setShowTimeZoneResults(true)
                    }}
                    onBlur={() => setTimeout(() => setShowTimeZoneResults(false), 120)}
                  />
                  <label className="flabel" htmlFor="tz">
                    <span className="lglyph" aria-hidden="true">
                      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="21" r="12" fill="none" stroke="#7E8A9A" strokeWidth="3.5" />
                        <line x1="24.5" y1="29.5" x2="36" y2="41" stroke="#7E8A9A" strokeWidth="3.5" strokeLinecap="round" />
                        <polygon points="17.5,14 42.5,14 28.5,25" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="5" strokeLinejoin="round" />
                        <polygon points="17.5,14 42.5,14 28.5,25" fill="#1F2933" />
                      </svg>
                    </span>
                    Time Zone
                  </label>
                  {timeZoneInvalid && <p className="ferror">Select a Time Zone.</p>}
                </span>

                {showTimeZoneResults && (
                  <div className="lookup-results" role="listbox">
                    {filteredTimeZones.length === 0 ? (
                      <div className="lookup-empty">No matching Time Zone.</div>
                    ) : (
                      filteredTimeZones.map((z) => (
                        <button
                          key={z}
                          type="button"
                          className={`lookup-item${selectedTimeZone === z ? ' selected' : ''}`}
                          role="option"
                          aria-selected={selectedTimeZone === z}
                          onMouseDown={() => selectTimeZone(z)}
                        >
                          {z}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="fgroup">
              <span className="flabel" id="sendby-label">
                Send Requests by
              </span>
              <div className="sendrow">
                <div
                  className="chippair"
                  role="radiogroup"
                  aria-labelledby="sendby-label"
                >
                  {/* Only one legal value exists today, so this chip has no
                      onClick — but its "selected" class is still read off
                      state, not hardcoded, for when Text unlocks. */}
                  <button
                    className={`chip${sendBy === 'email' ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={sendBy === 'email'}
                  >
                    Email
                  </button>
                  <button
                    className="chip is-locked"
                    type="button"
                    aria-disabled="true"
                    aria-pressed={false}
                  >
                    <svg
                      className="lockglyph"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <rect
                        x="4"
                        y="10.5"
                        width="16"
                        height="10"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="2.2"
                      />
                      <path
                        d="M8 10.5V7.5a4 4 0 1 1 8 0v3"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />
                    </svg>
                    Text
                  </button>
                </div>
                <div className="gatenote">
                  Request Texting is available with a subscription &mdash; see
                  the banner below.
                </div>
              </div>
            </div>

            <div className="fgroup">
              <textarea
                className="ftextarea ftextarea-plain opt"
                id="nt"
                maxLength={NOTES_MAX}
                placeholder="Notes (optional)"
                aria-label="Notes (optional)"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
              <p className={`charcount${form.notes.length >= NOTES_MAX ? ' limit' : ''}`}>
                {form.notes.length} / {NOTES_MAX}
              </p>
            </div>

            {error && (
              <p className="ferror" role="alert" style={{ marginTop: 4 }}>
                {error}
              </p>
            )}
          </form>

          <div className="minreq">
            <b>Minimum required</b>&nbsp; A Name and an Email. Phone is
            optional and can be used for Text delivery with a subscription.
          </div>
        </div>

        <div className="subbanner" role="button" tabIndex={0}>
          See Subscription Features and Other Options
        </div>
        {tier !== 'subscriber' && (
          <div className="adslot" aria-hidden="true">
            <span className="adbox">AD &#8212; 320&#215;50 RESERVED</span>
          </div>
        )}
      </div>
    </div>
  )
}
