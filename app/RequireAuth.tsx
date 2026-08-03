'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
// import { supabase } from './src/lib/supabaseClient'
import { supabase } from '@/lib/supabaseClient'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function check() {
      setLoading(true)
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        router.replace('/login')
        return
      }
      setLoading(false)
    }
    check()
  }, [router])

  if (loading) return <div>Loading…</div>
  return <>{children}</>
}