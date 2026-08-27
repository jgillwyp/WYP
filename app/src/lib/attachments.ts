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
 * File extensions that would otherwise match the bare-domain heuristic
 * below (a short alpha "TLD"-shaped suffix) but are actually just a
 * filename someone typed as a Location ("report.pdf", not a website).
 * Not exhaustive — a genuinely obscure extension can still misfire — but
 * covers the common cases without maintaining a real TLD allowlist, which
 * would need constant updating as new gTLDs/ccTLDs appear.
 */
const FILE_EXTENSION_BLOCKLIST = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'odt',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'tif', 'tiff',
  'zip', 'rar', 'tar', 'gz',
  'mp3', 'wav', 'mp4', 'mov', 'avi', 'mkv',
  'exe', 'msi', 'dmg', 'app', 'apk',
  'json', 'xml', 'html', 'htm', 'css', 'js', 'ts',
  'log', 'ini', 'cfg', 'bak',
])

/**
 * Recognizes a ToDo Location that's a website — a full `https://ft.com` URL,
 * or a bare domain typed without a scheme (`ft.com`, `www.ft.com`) — and
 * returns the href to link to (adding `https://` for the bare-domain case).
 * Returns null for anything else, including a typed file path: the app has
 * no filesystem access to the user's device, so a path is always inert text
 * (see the plan doc / decisions log, 2026-08-14).
 *
 * A syntactic heuristic, not a liveness check. A live-verification approach
 * (HTTP HEAD, a ranged GET, or a DNS lookup against the typed value) was
 * considered and rejected, 2026-08-14 decisions log: a browser can't run any
 * of those against an arbitrary third-party origin itself (blocked by CORS
 * for any site that hasn't opted in), so it would need our own server to
 * proxy the request — which turns "decide how to render some text" into a
 * standing SSRF surface (a saved Location could point our server's own
 * outbound request at an internal address) for no real gain: a real site
 * that's briefly unreachable would wrongly stop rendering as a link, and a
 * live check doesn't answer the actual question here any better than the
 * shape of the text already does.
 */
/**
 * Core domain-shape check shared by urlLocationHref (a whole Location field,
 * guaranteed whitespace-free already) and linkifyText (2026-08-26, one
 * whitespace-split token out of a longer Description/Dialog body — never
 * passed anything containing whitespace itself, so the two callers differ
 * only in how they get down to a single token, not in how that token is
 * judged). Extracted rather than duplicated per this codebase's own
 * shared-helper convention (cf. AttachmentsPanel.tsx, RepeatControl.tsx).
 */
function hrefForUrlLikeToken(trimmed: string): string | null {
  if (trimmed === '') return null

  // Already has a scheme — trust URL() outright rather than the heuristic
  // below, and only ever link http(s), never mailto:/tel:/ftp:/etc.
  try {
    const u = new URL(trimmed)
    return u.protocol === 'http:' || u.protocol === 'https:' ? trimmed : null
  } catch {
    // No scheme — a bare domain is the common case ("ft.com", "www.ft.com"),
    // fall through to the heuristic below.
  }

  // Reject anything shaped like a file path before checking the domain
  // shape, so "C:\Reports\q3.pdf", "\\server\share", "/Users/jim/x",
  // "./notes.txt" never reach the domain regex at all.
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return null // C:\... or C:/...
  if (trimmed.startsWith('\\\\')) return null // \\server\share
  if (trimmed.startsWith('/') || trimmed.startsWith('~') || trimmed.startsWith('.')) return null
  if (trimmed.includes('\\') || /\s/.test(trimmed)) return null

  // Bare-domain shape: dot-separated labels, optional port/path/query.
  const domainPattern =
    /^(www\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?(\/\S*)?$/i
  if (!domainPattern.test(trimmed)) return null

  const host = trimmed.split(/[/:]/)[0]
  const tld = (host.split('.').pop() ?? '').toLowerCase()
  if (tld.length < 2 || FILE_EXTENSION_BLOCKLIST.has(tld)) return null

  return `https://${trimmed}`
}

export function urlLocationHref(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (/\s/.test(trimmed)) return null // a whole Location field is one token
  return hrefForUrlLikeToken(trimmed)
}

/**
 * Splits free text into plain-text and URL-like segments, for rendering a
 * read-only Description/Dialog body with clickable links (2026-08-26,
 * replacing ToDo Locations' own "add a URL" affordance — see
 * app/components/Linkified.tsx, which turns this into JSX). Trailing
 * punctuation a sentence would naturally have after a URL (".", ",", ")",
 * etc.) is peeled off the token before the domain check and reattached as
 * plain text afterward, so "see ft.com." doesn't link the trailing period.
 */
export type TextSegment = { text: string; href: string | null }

const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

export function linkifySegments(text: string): TextSegment[] {
  if (text === '') return []
  const parts = text.split(/(\s+)/) // keep whitespace as its own segments
  const segments: TextSegment[] = []
  for (const part of parts) {
    if (part === '' || /^\s+$/.test(part)) {
      if (part !== '') segments.push({ text: part, href: null })
      continue
    }
    const trailingMatch = part.match(TRAILING_PUNCTUATION)
    const trailing = trailingMatch ? trailingMatch[0] : ''
    const core = trailing ? part.slice(0, -trailing.length) : part
    const href = core ? hrefForUrlLikeToken(core) : null
    if (href) {
      segments.push({ text: core, href })
      if (trailing) segments.push({ text: trailing, href: null })
    } else {
      segments.push({ text: part, href: null })
    }
  }
  return segments
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
  /** Repeat carry-forward selection (migration 038, 2026-08-21) — whether
   * this Attachment/Location should be duplicated onto each future
   * occurrence of a repeating Request/ToDo. Only ever shown/editable when
   * the item actually has a Repeat set — see AttachmentsPanel's own
   * showCarryToggle prop. */
  carry_into_repeats?: boolean
}
