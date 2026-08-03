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

      router.replace('/')
    })()
  }, [router])

  return <div>Signing you in…</div>
}