'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import WypHeader from './WypHeader'
import { supabase } from '@/lib/supabaseClient'

/**
 * My Contacts (2026-08-09) — converted from
 * design/screens/WYP_contacts_list_palette1.html. Owner's spec: "should show
 * the name, notify method and related value (email or phone) - and upon
 * click open up a Contact Details screen for editing." RLS ("contacts:
 * owners select own", migration 002) already scopes this to the signed-in
 * owner. Sorted alphabetically by display_name — matches every other
 * lookup/list in the app except Housekeeping's own Log Out entry.
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
          <span className="glabel">My Contacts</span>
          <Link className="btn" href="/contacts/new">Add&nbsp;Contact</Link>
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
