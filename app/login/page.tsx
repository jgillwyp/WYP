'use client'

import { useState } from 'react'

import { supabase } from '@/lib/supabaseClient'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signInWithMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // IMPORTANT: after clicking the email link, Supabase redirects here.
        // Configure this allowed URL in Supabase dashboard (Auth -> URL Configuration).
	const { error } = await supabase.auth.signInWithOtp({
  		email,
  		options: {
    		emailRedirectTo: `${window.location.origin}/auth/callback`,
  		},
	})
        // optionally prevent auto-signup:
        // shouldCreateUser: false,
      },
    })

    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <main style={{ maxWidth: 420, margin: '40px auto', padding: 16 }}>
      <h1>Sign in</h1>

      <form onSubmit={signInWithMagicLink} style={{ display: 'grid', gap: 12 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          type="email"
          required
        />

        <button disabled={loading} type="submit">
          {loading ? 'Sending…' : 'Send magic link'}
        </button>

        {error && <p style={{ color: 'red' }}>{error}</p>}
      </form>
    </main>
  )
}