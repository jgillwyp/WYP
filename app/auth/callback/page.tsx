'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.error('getSession error:', error)
        router.replace('/login')
        return
      }

      if (!data.session) {
        router.replace('/login')
        return
      }

      // First-run redirect (2026-08-11, owner decision) — completes the
      // design the Week 1 schema comment on profiles.display_name already
      // described: "NULL means account setup is incomplete, which is how
      // /auth/callback decides whether to route to Create my Free Account."
      // The profiles row itself always exists by this point (handle_new_user
      // trigger creates it the moment signInWithOtp creates the auth.users
      // row), so a missing row here is treated the same as an incomplete one
      // rather than as a separate error state.
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', data.session.user.id)
        .single()

      router.replace(profile?.display_name ? '/' : '/account/new')
    })()
  }, [router])

  return <div>Signing you in…</div>
}