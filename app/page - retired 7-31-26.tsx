'use client'

import RequireAuth from './RequireAuth'

export default function Home() {
  return (
    <RequireAuth>
      <div>Logged in ✅</div>
    </RequireAuth>
  )
}

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

export default function LoginPage() {
  const [email, setEmail] = useState('')

  async function sendMagicLink() {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) alert(error.message)
  }

  return (
    <div>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <button onClick={sendMagicLink}>Send magic link</button>
    </div>
  )
}
