'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { detectBrowserTimeZone, getAllTimeZones } from '@/lib/timeZones'

/**
 * Create Free Account (first run) — converted by hand from
 * design/screens/WYP_create_free_account_palette1.html.
 *
 * NOT a sign-up screen. The mockup's own footer copy says it directly: "No
 * password on this account — you have already signed in with the one-time
 * link emailed to the address above." signInWithOtp already created the
 * auth.users row and, via the handle_new_user trigger (Week 1 SQL history),
 * a matching profiles row with display_name = null. This screen's only job
 * is to fill in the profile fields OTP alone can't supply — First/Last/
 * Display Name, Time Zone, Phone, Notify Me By — via UPDATE, never INSERT.
 * Email is read-only (`.metarow`, §6.28), sourced from the session, not
 * collected here — consistent with "no separate signup step" in CLAUDE.md's
 * Auth section, not a conflict with it.
 *
 * Wired as the mandatory first-run step 2026-08-11 (owner decision, see
 * decisions log): app/auth/callback/page.tsx redirects here whenever
 * profiles.display_name is null, exactly the behavior the original Week 1
 * schema comment on that column already described as the plan
 * ("NULL means account setup is incomplete, which is how /auth/callback
 * decides whether to route to Create my Free Account") — this file and that
 * redirect are what finally build it.
 *
 * No Cancel button — matches the mockup's own header comment: at this point
 * the person is authenticated but has no completed profile, so an exit here
 * would strand the account with no way back in except another magic link
 * landing here again. Cancel/Sign out belong on the returning-user Account
 * screen instead (still undesigned — see CLAUDE.md).
 *
 * Time Zone follows AddContactForm.tsx's exact pattern (lookup list,
 * browsing-on-focus, selectedTimeZone guard) but simpler: this screen is
 * where profiles.time_zone first gets a value, so there's no prior stored
 * value to prefer — it defaults straight from the browser and is editable
 * if that guess is wrong. Requires migration 013 (grant UPDATE(time_zone)
 * on profiles to authenticated) to actually save — see docs/Week4 - SQL
 * history.txt; until the owner runs it, Save will surface a permission
 * error on this field specifically.
 */

type AccountFormState = {
  firstName: string
  lastName: string
  displayName: string
  phone: string
  timeZone: string
}

const initialState: AccountFormState = {
  firstName: '',
  lastName: '',
  displayName: '',
  phone: '',
  timeZone: '',
}

export default function CreateFreeAccountForm() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [form, setForm] = useState<AccountFormState>(initialState)

  // Notify Me By is fixed to 'email' — Text is a subscription feature not
  // built yet (SMS/10DLC deferred, same as Add Contact's own sendBy chip),
  // so the Text chip is locked outright rather than gated on profiles.tier.
  // Kept as state, not a plain constant, for the same reason AddContactForm
  // keeps sendBy as state: the day this unlocks needs a click handler and a
  // second value, not a rewrite of how the chip reads its own state.
  const [notifyBy] = useState<'email'>('email')

  const [firstNameInvalid, setFirstNameInvalid] = useState(false)
  const [lastNameInvalid, setLastNameInvalid] = useState(false)
  const [displayNameInvalid, setDisplayNameInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [timeZones] = useState<string[]>(() => getAllTimeZones())
  const [selectedTimeZone, setSelectedTimeZone] = useState<string | null>(null)
  const [showTimeZoneResults, setShowTimeZoneResults] = useState(false)
  const [timeZoneInvalid, setTimeZoneInvalid] = useState(false)
  const [timeZoneBrowsing, setTimeZoneBrowsing] = useState(false)

  // Load the session email (for the read-only metarow) and any already-set
  // profile fields — a person can land back here again if an earlier Save
  // attempt errored partway, so this isn't purely a blank-slate screen.
  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: userData } = await supabase.auth.getUser()
      if (cancelled || !userData.user) return
      setEmail(userData.user.email ?? '')

      const { data } = await supabase
        .from('profiles')
        .select('first_name, last_name, display_name, phone, time_zone')
        .eq('id', userData.user.id)
        .single()
      if (cancelled) return

      const zone = (data?.time_zone as string | null) || detectBrowserTimeZone()
      setForm({
        firstName: (data?.first_name as string | null) ?? '',
        lastName: (data?.last_name as string | null) ?? '',
        displayName: (data?.display_name as string | null) ?? '',
        phone: (data?.phone as string | null) ?? '',
        timeZone: zone,
      })
      setSelectedTimeZone(zone)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  function set<K extends keyof AccountFormState>(key: K, value: AccountFormState[K]) {
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
    const hasFirstName = form.firstName.trim() !== ''
    const hasLastName = form.lastName.trim() !== ''
    const hasDisplayName = form.displayName.trim() !== ''
    const hasTimeZone = selectedTimeZone !== null

    setFirstNameInvalid(!hasFirstName)
    setLastNameInvalid(!hasLastName)
    setDisplayNameInvalid(!hasDisplayName)
    setTimeZoneInvalid(!hasTimeZone)

    return hasFirstName && hasLastName && hasDisplayName && hasTimeZone
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!validate()) return

    setSaving(true)

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      setError('Your session has expired. Sign in again and retry.')
      setSaving(false)
      return
    }

    // UPDATE, not insert — the row already exists (handle_new_user trigger,
    // Week 1 SQL history) from the moment the magic link created the
    // account. See this file's header comment re: migration 013 for why
    // time_zone specifically can fail here until that grant is run.
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        display_name: form.displayName.trim(),
        phone: form.phone.trim() || null,
        time_zone: selectedTimeZone,
        notify_by: notifyBy,
      })
      .eq('id', userData.user.id)

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    router.push('/')
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">Create Free Account</span>
          <span className="bandcluster">
            <button
              className="btn"
              type="submit"
              form="create-free-account-form"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </span>
        </div>

        <div className="scroll">
          <form
            className="form"
            id="create-free-account-form"
            onSubmit={handleSubmit}
            noValidate
          >
            <div className="fgroup">
              <div className="metarow">
                <span className="mlabel">Email:</span>
                <span className="mval">{email}</span>
              </div>
              <div className="lockrow">
                <span>Your email address is also your sign-in ID.</span>
              </div>
            </div>

            <div className={`fgroup ffloat${firstNameInvalid ? ' is-invalid' : ''}`} style={{ marginTop: 14 }}>
              <input
                className="finput req"
                id="ufn"
                type="text"
                autoComplete="given-name"
                placeholder=" "
                value={form.firstName}
                onChange={(e) => {
                  set('firstName', e.target.value)
                  if (firstNameInvalid) setFirstNameInvalid(false)
                }}
              />
              <label className="flabel" htmlFor="ufn">
                First Name
              </label>
              {firstNameInvalid && <p className="ferror">Enter a First Name.</p>}
            </div>

            <div className={`fgroup ffloat${lastNameInvalid ? ' is-invalid' : ''}`}>
              <input
                className="finput req"
                id="uln"
                type="text"
                autoComplete="family-name"
                placeholder=" "
                value={form.lastName}
                onChange={(e) => {
                  set('lastName', e.target.value)
                  if (lastNameInvalid) setLastNameInvalid(false)
                }}
              />
              <label className="flabel" htmlFor="uln">
                Last Name
              </label>
              {lastNameInvalid && <p className="ferror">Enter a Last Name.</p>}
            </div>

            <div className={`fgroup ffloat${displayNameInvalid ? ' is-invalid' : ''}`}>
              <input
                className="finput req"
                id="udn"
                type="text"
                placeholder=" "
                value={form.displayName}
                onChange={(e) => {
                  set('displayName', e.target.value)
                  if (displayNameInvalid) setDisplayNameInvalid(false)
                }}
              />
              <label className="flabel" htmlFor="udn">
                Display Name
              </label>
              {displayNameInvalid && <p className="ferror">Enter a Display Name.</p>}
            </div>
            <div className="lockrow">
              <span>Recipients see your Display Name on every request you send.</span>
            </div>

            <div className="fgroup ffloat picker" style={{ marginTop: 14, position: 'relative' }}>
              <input
                className="finput req"
                id="utz"
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
              <label className="flabel" htmlFor="utz">
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

            <div className="fgroup" style={{ marginTop: 14 }}>
              <div className="phone-row">
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
                  <input
                    className="finput opt"
                    id="uph"
                    type="tel"
                    autoComplete="tel-national"
                    inputMode="tel"
                    placeholder=" "
                    value={form.phone}
                    onChange={(e) => set('phone', e.target.value)}
                  />
                  <label className="flabel" htmlFor="uph">
                    Phone (optional)
                  </label>
                </span>
              </div>
            </div>

            <div className="fgroup">
              <span className="flabel" id="notify-label">
                Notify me by
              </span>
              <div className="sendrow">
                <div className="chippair" role="radiogroup" aria-labelledby="notify-label">
                  <button
                    className={`chip${notifyBy === 'email' ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={notifyBy === 'email'}
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
                <div className="gatenote">Text notifications are available with a subscription.</div>
              </div>
            </div>

            {error && (
              <p className="ferror" role="alert" style={{ marginTop: 4 }}>
                {error}
              </p>
            )}
          </form>

          <div className="minreq">
            <b>No password on this account</b>&nbsp; You have already signed in with the
            one-time link emailed to the address above, so there is nothing to change,
            reset, or forget.
          </div>
        </div>
      </div>
    </div>
  )
}
