'use client'

import RequireAuth from './RequireAuth'
import MainScreen from './components/MainScreen'

export default function Home() {
  return (
    <RequireAuth>
      <MainScreen />
    </RequireAuth>
  )
}
