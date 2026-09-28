'use client'

import RequireAuth from '../RequireAuth'
import PrivateCategoriesList from '../components/PrivateCategoriesList'

export default function PrivateCategoriesPage() {
  return (
    <RequireAuth>
      <PrivateCategoriesList />
    </RequireAuth>
  )
}
