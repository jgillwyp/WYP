// src/lib/attachments.ts
//
// Shared constants and pure helpers for the Attachments feature (Week 5
// Priority 3 — see docs/WYP_Attachments_Plan.md and the decisions log's
// 2026-08-14 entries for the reasoning behind every number below). Used by
// both the client-side forms (for immediate feedback before ever hitting
// the network) and the app/api/attachments/* routes (the real,
// can't-be-bypassed enforcement — CLAUDE.md's "the button is a courtesy"
// rule applies here exactly as it does to every SECURITY DEFINER function
// elsewhere in this app: client-side checks are convenience, not security).

/** 10 MB — a recommendation, not a number the owner specified; easy to
 * raise later, see the plan doc's open question #2. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Per Request/ToDo, both kinds counted together. Owner: "the number 15
 * seems reasonable, 10 would also work... this app isn't intended to be a
 * 'file-transfer service'" — picked 10. */
export const MAX_ATTACHMENTS_PER_ITEM = 10

/**
 * Executable/installer/script extensions only — everything else (documents,
 * images, PDFs, archives, media, anything else) is allowed. Owner: "I don't
 * care about file types - unless you indicate there are types we should not
 * support." Request Response accepts uploads from anonymous, unauthenticated
 * recipients, so this exists specifically to keep that surface from becoming
 * a way to distribute executable content — not a general file-type
 * restriction, and not a substitute for real virus scanning (out of scope
 * for v1, see the plan doc).
 */
export const BLOCKED_EXTENSIONS = [
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.ps1', '.sh', '.jar', '.app', '.dmg',
]

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase()
}

export function isBlockedFileType(fileName: string): boolean {
  return BLOCKED_EXTENSIONS.includes(fileExtension(fileName))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Appends " (1)", " (2)", ... to fileName until it no longer collides with
 * existingNames — decided 2026-08-14 (decisions log), for the case where an
 * added attachment's name matches one already on the same Request/ToDo.
 * Preserves the extension: "report.pdf" -> "report (1).pdf".
 */
export function dedupeFileName(fileName: string, existingNames: string[]): string {
  if (!existingNames.includes(fileName)) return fileName
  const dot = fileName.lastIndexOf('.')
  const base = dot === -1 ? fileName : fileName.slice(0, dot)
  const ext = dot === -1 ? '' : fileName.slice(dot)
  let n = 1
  let candidate = `${base} (${n})${ext}`
  while (existingNames.includes(candidate)) {
    n += 1
    candidate = `${base} (${n})${ext}`
  }
  return candidate
}

/**
 * Only a well-formed http(s) URL renders as an actual clickable link on a
 * ToDo Location — a typed local file path is inert text the app can never
 * open or verify (no filesystem access to the user's device). See the plan
 * doc / decisions log, 2026-08-14.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export type AttachmentRow = {
  id: string
  kind: 'file' | 'reference'
  file_name: string | null
  size_bytes: number | null
  mime_type: string | null
  reference_url: string | null
  reference_note: string | null
  uploaded_by: string | null
  uploaded_by_label: string
  created_at: string
  /** Signed Storage URL, present only on 'file' rows, only from
   * /api/attachments/list — never persisted, always generated on demand. */
  url?: string
}
