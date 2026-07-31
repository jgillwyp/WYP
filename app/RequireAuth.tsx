'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let sub: any
    ;(async () => {
      setLoading(true)
      const { data } = await supabase.auth.getUser()
      if (!data.user) window.location.replace('/login')
      setLoading(false)

      sub = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session?.user) window.location.replace('/login')
      })
    })()

    return () => {
      sub?.subscription?.unsubscribe?.()
    }
  }, [])

  if (loading) return null
  return <>{children}</>
}