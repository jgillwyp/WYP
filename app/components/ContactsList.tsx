'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

/**
 * Contacts (2026-08-09, retitled from "My Contacts" same day) — converted
 * from design/screens/WYP_contacts_list_palette1.html. Owner's spec: "should
 * show the name, notify method and related value (email or phone) - and
 * upon click open up a Contact Details screen for editing (and should have
 * a Close button)." RLS ("contacts: owners select own", migration 002)
 * already scopes this to the signed-in owner. Sorted alphabetically by
 * display_name — matches every other lookup/list in the app except
 * Housekeeping's own Log Out entry.
 *
 * Retitled the same day the Close button was added — title+Close would
 * wrap on Android, and separately, the owner's rule is that a navigation
 * destination's title should repeat exactly what its Housekeeping row was
 * named when selected (that row is "Contacts" too, see MainScreen.tsx).
 */

type Contact = {
  id: string
  display_name: string
  email: string
  phone: string | null
  send_by: 'email' | 'text'
  time_zone: string | null
  notes: string | null
}

// get_contact_request_counts() (migration 030, confirmed run by the owner
// 2026-08-15) — one row per contact, Sent (my own Requests to them) and
// Rec'd (Requests they've sent me, matched via their real login email
// against this contact's stored email). See that migration's own header
// comment in docs/Week6 - SQL history.txt for the full reasoning.
type ContactCounts = { contact_id: string; sent_count: number; received_count: number }

// Print (2026-08-15) — new, from the owner's own "Contacts list.xlsx"
// mockup. Same afterprint-driven pattern as every other print report in
// the app (MainScreen.tsx/ArchiveForm.tsx/RequestDetailForm.tsx/
// TodoDetailForm.tsx), including the printTick fix from the start this
// time — see those files' own comments for the full "stuck print state"
// write-up this avoids by construction.

export default function ContactsList() {
  const router = useRouter()

  const [contacts, setContacts] = useState<Contact[]>([])
  const [counts, setCounts] = useState<Record<string, ContactCounts>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showPrint, setShowPrint] = useState(false)
  const [printTick, setPrintTick] = useState(0)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('contacts')
      .select('id, display_name, email, phone, send_by, time_zone, notes')
      .order('display_name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setLoadError(error.message)
        } else {
          setContacts(data ?? [])
        }
        setLoading(false)
      })

    supabase
      .rpc('get_contact_request_counts')
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        const map: Record<string, ContactCounts> = {}
        for (const row of data as ContactCounts[]) {
          map[row.contact_id] = row
        }
        setCounts(map)
      })

    return () => {
      cancelled = true
    }
  }, [])

  function startPrint() {
    setShowPrint(true)
    setPrintTick((t) => t + 1)
  }

  useEffect(() => {
    if (printTick === 0) return
    window.print()
    function handleAfterPrint() {
      setShowPrint(false)
    }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [printTick])

  return (
    <div className="frame-none">
      <div className="app no-print">
        <WypHeader
          action={
            <button
              className="iconbtn"
              type="button"
              aria-label="Print Contacts"
              onClick={startPrint}
              style={{ marginLeft: 'auto' }}
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M7 8V3h10v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="4" y="8" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M7 14h10v7H7v-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </button>
          }
        />

        <div className="band">
          <span className="glabel">Contacts</span>
          <span className="bandcluster">
            <Link className="btn" href="/contacts/new">Add&nbsp;Contact</Link>
            <button className="btn-secondary" type="button" onClick={() => router.push('/')}>
              Close
            </button>
          </span>
        </div>

        <div className="scroll">
          {loading && <div className="subempty">Loading…</div>}
          {!loading && loadError && <div className="subempty">{loadError}</div>}
          {!loading && !loadError && contacts.length === 0 && (
            <div className="subempty">No Contacts yet — use Add Contact.</div>
          )}
          {!loading && !loadError && contacts.length > 0 && (
            <div className="hkrows">
              {contacts.map((c) => {
                const note = c.send_by === 'text'
                  ? `Text: ${c.phone ?? '—'}`
                  : `Email: ${c.email}`
                return (
                  <div
                    key={c.id}
                    className="hkrow"
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/contacts/${c.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/contacts/${c.id}`) }}
                  >
                    <span className="hktext">
                      <span className="hktitle">{c.display_name}</span>
                      <span className="hknote"> — {note}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Print (2026-08-15) — from the owner's own "Contacts list.xlsx"
          mockup. Title reads "Contacts", not the xlsx's own "My Contacts" —
          this screen dropped "My" app-wide back on 2026-08-09 (see
          CLAUDE.md/decisions log), so the print title matches the screen's
          actual, current name rather than reproducing the mockup's literal
          text; flagged here rather than silently decided. Sent/Rec'd counts
          come from get_contact_request_counts() (migration 030, confirmed
          run by the owner 2026-08-15). */}
      {showPrint && (
        <div className="print-report">
          <div className="ptitle">Contacts</div>
          <div className="pcon-legend">(Asterisks indicate communication method.)</div>
          <div className="pcon-colbar">
            <span>Contact Name</span>
            <span>Email</span>
            <span>Phone</span>
            <span>Time Zone</span>
            <span className="pcon-c-count">Sent</span>
            <span className="pcon-c-count">Rec&apos;d</span>
          </div>
          <div className="pcon-rows">
            {contacts.length === 0 && <div className="pempty">No Contacts to print.</div>}
            {contacts.map((c) => {
              const emailText = c.send_by === 'email' ? `${c.email} *` : c.email
              const phoneText = c.phone ? (c.send_by === 'text' ? `${c.phone} *` : c.phone) : ''
              const cnt = counts[c.id]
              return (
                <div key={c.id} className="pcon-row">
                  <span className="pcon-name">{c.display_name}</span>
                  <span className="pcon-email">{emailText}</span>
                  <span className="pcon-phone">{phoneText}</span>
                  <span className="pcon-tz">{c.time_zone ?? ''}</span>
                  <span className="pcon-count">{cnt ? cnt.sent_count : ''}</span>
                  <span className="pcon-count">{cnt ? cnt.received_count : ''}</span>
                  {c.notes && <div className="pcon-notes">{c.notes}</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
