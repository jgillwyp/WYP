'use client'

// Requests Activity screen (Statistics section) — see
// AdminContactsStatsForm.tsx's own header comment; same scaffold-only
// status.
import { useRouter } from 'next/navigation'
import WypHeader from './WypHeader'

export default function AdminRequestsStatsForm() {
  const router = useRouter()
  return (
    <div className="frame-none">
      <div className="app">
        <WypHeader />
        <div className="band">
          <span className="glabel">Requests — Activity</span>
          <span className="bandcluster">
            <button className="btn" type="button" onClick={() => router.back()}>
              Close
            </button>
          </span>
        </div>
        <div className="scroll">
          <div className="subempty">
            Requests Activity is being built next — Created, Changed, Done, Deleted,
            Archived, Unarchived, Attachments, and Dialog, Sent/Received split,
            per week or month.
          </div>
        </div>
      </div>
    </div>
  )
}
