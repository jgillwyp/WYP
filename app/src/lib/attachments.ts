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

/** Free-tier total Attachment storage allowance, in bytes — 100 MB.
 * Added 2026-08-27 when Attachments moved from a subscriber-only feature to
 * free-with-limits (Jim's own wording: "100MB of storage — for attachments
 * (additional storage available with a subscription)"). Enforced against
 * the owning account's running total across every Request/ToDo they own,
 * never a single item — see app/api/attachments/_shared.ts's
 * getOwnerStorageStatus(), the actual, can't-be-bypassed check. This
 * constant exists here only so client-side messaging can quote the same
 * number without duplicating it. A Subscriber's own allowance is instead
 * profiles.subscription_storage_gb (migration 047) — a real per-account
 * value, not a fixed constant, since it can grow via the (not yet built)
 * storage add-on purchase. */
export const FREE_TIER_STORAGE_LIMIT_BYTES = 100 * 1024 * 1024

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

/**
 * Office document extensions Microsoft's own free Office Online viewer
 * (view.officeapps.live.com) can render — Word/Excel/PowerPoint, old and
 * new formats plus a few compatible ones it also accepts (rtf, odt/ods/odp).
 * Anything else (PDF, images, zip, etc.) is unaffected by officeViewerUrl
 * below — a browser already renders PDFs/images inline on its own, and
 * there's no equivalent free viewer worth adding for other binary types.
 */
const OFFICE_VIEWABLE_EXTENSIONS = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx',
  '.rtf', '.odt', '.ods', '.odp',
])

export function isOfficeViewable(fileName: string): boolean {
  return OFFICE_VIEWABLE_EXTENSIONS.has(fileExtension(fileName))
}

/**
 * Wraps a signed attachment URL in Microsoft's free Office Online viewer
 * (2026-08-27) — owner-reported, testing on a phone: tapping an .xlsx
 * attachment correctly triggered Chrome's own "Download this file?"
 * prompt (not a bug), but a download's only destination is a device
 * folder ("Downloads") most users don't know how to find afterward, and
 * a bare download gives no in-page confirmation once it completes. Office
 * Online renders the document directly in the browser instead — no
 * download, nothing to go looking for. Deliberate trade-off, confirmed
 * with the owner before building: this sends the attachment's temporary
 * signed URL to Microsoft's own servers so they can fetch and render it,
 * a real third-party dependency and a privacy consideration for anything
 * sensitive in the file — accepted in exchange for a phone experience that
 * doesn't depend on which apps happen to be installed. Only ever called
 * for isOfficeViewable() file names; everything else (PDFs, images, zips,
 * ToDo Locations) is untouched and still links straight to its own URL.
 */
export function officeViewerUrl(signedUrl: string): string {
  return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(signedUrl)}`
}

/**
 * Extensions a browser renders sensibly as CONTENT when opened directly —
 * images, PDF, plain text. Deliberately narrow, and deliberately an
 * allowlist rather than a blocklist of "known bad" types (2026-09-04,
 * owner-reported): a .ics file isn't rendered at all — most browsers either
 * force a download or hand it to a calendar app/webmail client (Outlook Web,
 * inconsistently) — and an .html file "renders" by literally becoming a
 * page, indistinguishable from the app's own UI and a real risk if the file
 * ever contained a script tag. Neither is "viewing an attachment" in any
 * useful sense, and an allowlist means a similarly bad type (.json, .xml,
 * .eml, .vcf, etc.) is automatically caught too, rather than requiring its
 * own named exception the way a blocklist would.
 */
const BROWSER_RENDERABLE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tif', '.tiff', '.ico',
  '.pdf',
  '.txt',
])

/**
 * True when clicking straight through to the attachment's own signed URL (or,
 * for an Office type, its officeViewerUrl() wrapper) actually shows the
 * person their file — never true for the myriad other extensions a raw link
 * would hand the browser to guess at (an .ics forced into Outlook Web, an
 * .html file rendering as if it were part of the app, etc.). Both
 * AttachmentsPanel.tsx (Request/ToDo screens) and StorageManagementForm.tsx
 * check this before turning a file name into a "View" link; when false, they
 * show a small dialog ("This file type can't be viewed here — download it
 * instead.") with a real Download link (download_url) rather than letting
 * the browser do something inconsistent and confusing.
 */
export function isViewableInBrowser(fileName: string): boolean {
  return isOfficeViewable(fileName) || BROWSER_RENDERABLE_EXTENSIONS.has(fileExtension(fileName))
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
  /** Signed Storage URL for VIEWING, present only on 'file' rows, only from
   * /api/attachments/list — never persisted, always generated on demand. */
  url?: string
  /** A second signed Storage URL for the same object, with Supabase's own
   * `download` option set (2026-09-04) — forces a real
   * `Content-Disposition: attachment` response instead of letting the
   * browser render the content-type inline. Present only on 'file' rows.
   * `url` above is still what a "View" link (a name click, or an
   * Office-viewable file routed through officeViewerUrl) should use. */
  download_url?: string | null
  /** Repeat carry-forward selection (migration 038, 2026-08-21) — whether
   * this Attachment/Location should be duplicated onto each future
   * occurrence of a repeating Request/ToDo. Only ever shown/editable when
   * the item actually has a Repeat set — see AttachmentsPanel's own
   * showCarryToggle prop. */
  carry_into_repeats?: boolean
}
