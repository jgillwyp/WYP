'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    ;(async () => {
      // Supabase handles token in URL; you need to let it complete then go to app
      const { data } = await supabase.auth.getSession()
      if (data.session) router.replace('/')
      else router.replace('/login')
    })()
  }, [router])

  return <div>Signing you in...</div>
}