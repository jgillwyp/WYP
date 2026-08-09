'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

/**
 * Contact Detail (2026-08-09) — converted from
 * design/screens/WYP_contact_detail_palette1.html. "Exactly the same as
 * Create Contact except for the screen title" (owner's instruction), plus
 * one deliberate difference: Save + Close, not Save + Cancel — see the
 * mockup's file header comment for why. Mirrors AddContactForm.tsx's actual
 * live fields (Name/Email/Phone/Notes) rather than the mockup's Time Zone
 * field, which isn't wired anywhere yet — see that mockup's comment.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ContactFormState = {
  name: string
  email: string
  phone: string
  notes: string
}

export default function ContactDetailForm() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const contactId = params.id

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [form, setForm] = useState<ContactFormState>({ name: '', email: '', phone: '', notes: '' })
  const [sendBy] = useState<'email'>('email')

  const [nameInvalid, setNameInvalid] = useState(false)
  const [emailInvalid, setEmailInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!contactId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const { data, error: fetchError } = await supabase
        .from('contacts')
        .select('display_name, email, phone, notes')
        .eq('id', contactId)
        .single()

      if (cancelled) return

      if (fetchError || !data) {
        setLoadError(fetchError?.message ?? 'Could not load this Contact.')
        setLoading(false)
        return
      }

      setForm({
        name: data.display_name ?? '',
        email: data.email ?? '',
        phone: data.phone ?? '',
        notes: data.notes ?? '',
      })
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [contactId])

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

    const { error: updateError } = await supabase
      .from('contacts')
      .update({
        display_name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        send_by: sendBy,
        notes: form.notes.trim() || null,
      })
      .eq('id', contactId)

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    router.push('/contacts')
  }

  function handleClose() {
    router.push('/contacts')
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

            <div className="fgroup ffloat">
              <textarea
                className="ftextarea opt"
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
            <b>Minimum required</b>&nbsp; A Name and an Email. Phone is optional and can be used for Text delivery with a subscription.
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
