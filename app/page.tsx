'use client'

import RequireAuth from './RequireAuth'

export default function Home() {
  return (
    <RequireAuth>
      <div>Logged in ✅</div>
    </RequireAuth>
  )
}
