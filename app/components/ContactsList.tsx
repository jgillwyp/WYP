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
}

export default function ContactsList() {
  const router = useRouter()

  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('contacts')
      .select('id, display_name, email, phone, send_by')
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

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />

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
    </div>
  )
}
