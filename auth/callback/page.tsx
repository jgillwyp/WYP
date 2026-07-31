// app/auth/callback/page.tsx
'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function AuthCallback() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Supabase JS should pick up the auth code from the URL automatically.
    // Redirect after sign-in:
    router.replace(searchParams.get('redirectTo') ?? '/')
  }, [router, searchParams])

  return <div>Signing you in…</div>
}