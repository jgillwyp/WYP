'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'
import { detectBrowserTimeZone, getAllTimeZones } from '@/lib/timeZones'

/**
 * Contact Detail (2026-08-09) — converted from
 * design/screens/WYP_contact_detail_palette1.html. "Exactly the same as
 * Create Contact except for the screen title" (owner's instruction), plus
 * one deliberate difference: Save + Close, not Save + Cancel — see the
 * mockup's file header comment for why. Mirrors AddContactForm.tsx's actual
 * live fields (Name/Email/Phone/Notes/Time Zone).
 *
 * Time Zone (Week 3, migration 007): same required §6.16 lookup as
 * AddContactForm.tsx — see that file's header comment for the full
 * reasoning, including the browse-on-focus fix (2026-08-09) via
 * `timeZoneBrowsing`. The one difference here: this contact may already
 * have its own `time_zone` from a previous Save, which takes priority over
 * the profiles.time_zone / browser-detection fallback chain used when
 * adding a new one.
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

export default function ContactDetailForm() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const contactId = params.id

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [form, setForm] = useState<ContactFormState>({ name: '', email: '', phone: '', phoneExt: '', notes: '', timeZone: '' })
  const [sendBy] = useState<'email'>('email')

  const [nameInvalid, setNameInvalid] = useState(false)
  const [emailInvalid, setEmailInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [timeZones] = useState<string[]>(() => getAllTimeZones())
  const [selectedTimeZone, setSelectedTimeZone] = useState<string | null>(null)
  const [showTimeZoneResults, setShowTimeZoneResults] = useState(false)
  const [timeZoneInvalid, setTimeZoneInvalid] = useState(false)
  const [timeZoneBrowsing, setTimeZoneBrowsing] = useState(false)

  // tier — 2026-08-25, closing a gap flagged the same day the ad banner was
  // first gated on Main Screen: it, and every owner-side screen, still
  // showed .adslot unconditionally. This is the signed-in owner's own
  // account, so their own tier is the right thing to gate on (unlike a
  // Request's Attachments, which follow the issuer's tier per this file's
  // own Entitlements precedent — an ad-free benefit is personal, not a
  // property of any one Contact/Request). A separate, always-run fetch
  // rather than piggybacking on the `profiles.time_zone` query above, which
  // only runs in the rare pre-migration-007 fallback branch and would leave
  // `tier` unset for the common case.
  const [tier, setTier] = useState<'free' | 'subscriber'>('free')

  useEffect(() => {
    let cancelled = false
    async function loadTier() {
      const { data } = await supabase.from('profiles').select('tier').single()
      if (!cancelled) setTier(data?.tier === 'subscriber' ? 'subscriber' : 'free')
    }
    loadTier()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!contactId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const { data, error: fetchError } = await supabase
        .from('contacts')
        .select('display_name, email, phone, phone_ext, notes, time_zone')
        .eq('id', contactId)
        .single()

      if (cancelled) return

      if (fetchError || !data) {
        setLoadError(fetchError?.message ?? 'Could not load this Contact.')
        setLoading(false)
        return
      }

      if (data.time_zone) {
        setForm({
          name: data.display_name ?? '',
          email: data.email ?? '',
          phone: data.phone ?? '',
          phoneExt: data.phone_ext ?? '',
          notes: data.notes ?? '',
          timeZone: data.time_zone,
        })
        setSelectedTimeZone(data.time_zone)
        setLoading(false)
        return
      }

      // This contact predates migration 007 (or was never given one) — fall
      // back the same way AddContactForm.tsx does for a new contact: the
      // owner's own profiles.time_zone if set, else the browser's detected
      // zone, with the same sticky write-back to profiles.time_zone if it
      // had to fall all the way to detection.
      const { data: profileData } = await supabase.from('profiles').select('time_zone').single()
      if (cancelled) return

      const fallbackZone = profileData?.time_zone ?? detectBrowserTimeZone()

      setForm({
        name: data.display_name ?? '',
        email: data.email ?? '',
        phone: data.phone ?? '',
        phoneExt: data.phone_ext ?? '',
        notes: data.notes ?? '',
        timeZone: fallbackZone,
      })
      setSelectedTimeZone(fallbackZone)
      setLoading(false)

      if (!profileData?.time_zone) {
        const { data: userData } = await supabase.auth.getUser()
        if (!cancelled && userData.user) {
          await supabase.from('profiles').update({ time_zone: fallbackZone }).eq('id', userData.user.id)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [contactId])

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

    const { error: updateError } = await supabase
      .from('contacts')
      .update({
        display_name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        phone_ext: form.phoneExt.trim() || null,
        send_by: sendBy,
        notes: form.notes.trim() || null,
        time_zone: selectedTimeZone,
      })
      .eq('id', contactId)

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    // router.back(), not push('/contacts') — this screen is only ever
    // reached by clicking a row on the Contacts list, so back() restores
    // that list's scroll position instead of landing at its top. Same
    // reasoning as RequestDetailForm.tsx / TodoDetailForm.tsx.
    router.back()
  }

  function handleClose() {
    router.back()
  }

  if (loading) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="subempty">Loading…</div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="frame-none">
        <div className="app">
          <WypHeader />
          <div className="subempty">{loadError}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

        <div className="band">
          <span className="glabel">Contact Detail</span>
          <span className="bandcluster">
            <button className="btn" type="submit" form="contact-detail-form" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-secondary" type="button" onClick={handleClose} disabled={saving}>
              Close
            </button>
          </span>
        </div>

        <div className="scroll">
          <form className="form" id="contact-detail-form" onSubmit={handleSubmit} noValidate>
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
                <button className="ccode opt" type="button" aria-label="Country code, United States, +1">
                  US&nbsp;+1 <span className="caret">&#9662;</span>
                </button>
                <span className="ffloat" style={{ flex: '1 1 auto', minWidth: 0, display: 'block' }}>
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
                {/* Ext. (2026-08-18) — see AddContactForm.tsx's identical
                    field for the full E.164/migration-034 reasoning. */}
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
                <div className="chippair" role="radiogroup" aria-labelledby="sendby-label">
                  <button className={`chip${sendBy === 'email' ? ' selected' : ''}`} type="button" aria-pressed={sendBy === 'email'}>
                    Email
                  </button>
                  <button className="chip is-locked" type="button" aria-disabled="true" aria-pressed={false}>
                    <svg className="lockglyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="4" y="10.5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
                      <path d="M8 10.5V7.5a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
                    Text
                  </button>
                </div>
                <div className="gatenote">
                  Request Texting is available with a subscription &mdash; see the banner below.
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
            <b>Minimum required</b>&nbsp; A Name and an Email. Phone is optional and can be used for Text delivery with a subscription.
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
