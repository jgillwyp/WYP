'use client'

// Sum and Averages screen (Statistics section) — see
// AdminContactsStatsForm.tsx's own header comment; same scaffold-only
// status.
import { useRouter } from 'next/navigation'
import WypHeader from './WypHeader'

export default function AdminSummaryStatsForm() {
  const router = useRouter()
  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />
        <div className="band">
          <span className="glabel">Sum and Averages</span>
          <span className="bandcluster">
            <button className="btn" type="button" onClick={() => router.back()}>
              Close
            </button>
          </span>
        </div>
        <div className="scroll">
          <div className="subempty">
            Grand totals and the per-user roster are being built next.
          </div>
        </div>
      </div>
    </div>
  )
}
