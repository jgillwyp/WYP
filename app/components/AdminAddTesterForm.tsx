'use client'

// Add Private Tester (2026-11-06, migration 091, §6.47 PROPOSED) — replaces
// running docs/add-tester.mjs from a terminal. Jim, looking at a real run of
// that script: "The entry of the time zone is really awkward, the Grant
// Subscriber access is not required (I think all testers can grant
// themselves Subscriber status). Perhaps we could add this to the
// Statistics tab, rename the tab Admin and add an 'Add Private Tester'
// choice for an easier-to-use screen or dialog."
//
// Time Zone is now the same typeahead lookup Add Contact/Contact Detail
// already use (app/src/lib/timeZones.ts) instead of a blind text prompt, and
// is optional — leaving it blank skips it, exactly like the script's own
// "leave blank to skip" option, except there's no way here to type something
// that silently fails validation later (e.g. "america/l"): a typed value
// must be picked from the real list or cleared.
//
// "Grant Subscriber access?" is gone entirely — confirmed via AskUserQuestion
// (2026-11-06): every tester added this way is now ALWAYS given self-toggle
// access (tier_toggle_allowlist, via the admin_add_private_tester() RPC),
// with nobody auto-set to Subscriber tier at first sign-in. A tester who
// wants to test paid features flips Account Options' own "Subscribed?
// (testing only)" checkbox themselves — see migration 091's own header
// comment for the full reasoning.
//
// One RPC call does everything the script's two steps did (the immediate
// beta_allowlist/tier_toggle_allowlist inserts, plus queuing
// pending_tester_setup for the hourly cron's own "after sign-up" half) —
// admin_add_private_tester() re-checks is_admin itself, same posture every
// admin_stats_* RPC already uses, so this needs no service_role and no new
// API route.
//
// Deliberately stays on this screen after a successful add (reset-and-stay,
// not navigate-away) — Jim adds testers one after another in a real session,
// same repeatable shape as re-running the script for each new person.
import { useState } from 'react'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { getAllTimeZones } from '@/lib/timeZones'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type FormState = {
  email: string
  displayName: string
  timeZone: string
}

const initialState: FormState = { email: '', displayName: '', timeZone: '' }

export default function AdminAddTesterForm() {
  const router = useRouter()

  const [form, setForm] = useState<FormState>(initialState)
  const [emailInvalid, setEmailInvalid] = useState(false)
  const [nameInvalid, setNameInvalid] = useState(false)
  const [timeZoneInvalid, setTimeZoneInvalid] = useState(false)

  const [timeZones] = useState<string[]>(() => getAllTimeZones())
  const [selectedTimeZone, setSelectedTimeZone] = useState<string | null>(null)
  const [showTimeZoneResults, setShowTimeZoneResults] = useState(false)
  const [timeZoneBrowsing, setTimeZoneBrowsing] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addedEmail, setAddedEmail] = useState<string | null>(null)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
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
    const hasEmail = EMAIL_RE.test(form.email.trim())
    const hasName = form.displayName.trim() !== ''
    // Time Zone is optional — valid when blank, or when the text exactly
    // matches a picked zone. Invalid only when something was typed but never
    // actually selected from the list (the same guard Add Contact's own
    // required version uses, just not mandatory here).
    const hasValidTimeZone = timeZoneQueryEmpty || selectedTimeZone !== null

    setEmailInvalid(!hasEmail)
    setNameInvalid(!hasName)
    setTimeZoneInvalid(!hasValidTimeZone)

    return hasEmail && hasName && hasValidTimeZone
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAddedEmail(null)

    if (!validate()) return

    setSaving(true)
    const email = form.email.trim().toLowerCase()
    const { error: rpcError } = await supabase.rpc('admin_add_private_tester', {
      p_email: email,
      p_display_name: form.displayName.trim(),
      p_time_zone: selectedTimeZone,
    })
    setSaving(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setAddedEmail(email)
    setForm(initialState)
    setSelectedTimeZone(null)
  }

  function handleClose() {
    router.back()
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">Add Private Tester</span>
          <span className="bandcluster">
            <button className="btn" type="submit" form="add-tester-form" disabled={saving}>
              {saving ? 'Adding…' : 'Add'}
            </button>
            <button className="btn-secondary" type="button" onClick={handleClose}>
              Close
            </button>
          </span>
        </div>

        {addedEmail && (
          <div className="noticeband">
            Note: {addedEmail} can sign in now. Their name/time zone will be set automatically within the hour of
            their first sign-in, and they can grant themselves Subscriber access anytime via Account
            Options&rsquo; &ldquo;Subscribed? (testing only)&rdquo; checkbox.
          </div>
        )}

        <div className="scroll">
          <form className="form" id="add-tester-form" onSubmit={handleSubmit} noValidate>
            <div className={`fgroup ffloat${emailInvalid ? ' is-invalid' : ''}`}>
              <input
                className="finput req"
                id="at-email"
                type="email"
                autoComplete="off"
                inputMode="email"
                placeholder=" "
                value={form.email}
                onChange={(e) => {
                  set('email', e.target.value)
                  if (emailInvalid) setEmailInvalid(false)
                }}
              />
              <label className="flabel" htmlFor="at-email">
                Email
              </label>
              {emailInvalid && <p className="ferror">Enter a valid email address.</p>}
            </div>

            <div className={`fgroup ffloat${nameInvalid ? ' is-invalid' : ''}`}>
              <input
                className="finput req"
                id="at-name"
                type="text"
                autoComplete="off"
                placeholder=" "
                value={form.displayName}
                onChange={(e) => {
                  set('displayName', e.target.value)
                  if (nameInvalid) setNameInvalid(false)
                }}
              />
              <label className="flabel" htmlFor="at-name">
                Display Name
              </label>
              {nameInvalid && <p className="ferror">Enter a Display Name.</p>}
            </div>

            <div className="fgroup">
              <div className="frow" style={{ position: 'relative' }}>
                <span className="ffloat">
                  <input
                    className={`finput${timeZoneQueryEmpty ? ' opt' : ''}`}
                    id="at-tz"
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
                    onFocus={() => {
                      setTimeZoneBrowsing(true)
                      setShowTimeZoneResults(true)
                    }}
                    onBlur={() => setTimeout(() => setShowTimeZoneResults(false), 120)}
                  />
                  <label className="flabel" htmlFor="at-tz">
                    Time Zone <span className="subnote">(optional — leave blank to skip)</span>
                  </label>
                  {timeZoneInvalid && (
                    <p className="ferror">Select a Time Zone from the list, or clear the field to skip.</p>
                  )}
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

            {error && (
              <p className="ferror" role="alert" style={{ marginTop: 4 }}>
                {error}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
