'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

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
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ContactFormState = {
  name: string
  email: string
  phone: string
  notes: string
}

const initialState: ContactFormState = {
  name: '',
  email: '',
  phone: '',
  notes: '',
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

  function set<K extends keyof ContactFormState>(key: K, value: ContactFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function validate(): boolean {
    const hasName = form.name.trim() !== ''
    const hasEmail = EMAIL_RE.test(form.email.trim())

    setNameInvalid(!hasName)
    setEmailInvalid(!hasEmail)

    return hasName && hasEmail
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
    // but this app writes only display_name going forward.
    const { error: insertError } = await supabase.from('contacts').insert({
      owner_id: userData.user.id,
      display_name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      send_by: sendBy,
      notes: form.notes.trim() || null,
    })

    setSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    // No list view yet (Week 1 Days 4-5, step 4) — back to the main screen.
    router.push('/')
  }

  function handleCancel() {
    router.push('/')
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

            <div className="fgroup ffloat">
              <textarea
                className="ftextarea"
                id="nt"
                maxLength={500}
                placeholder=" "
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
              <label className="flabel" htmlFor="nt">
                Notes (optional)
              </label>
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
        <div className="adslot" aria-hidden="true">
          <span className="adbox">AD &#8212; 320&#215;50 RESERVED</span>
        </div>
      </div>
    </div>
  )
}
