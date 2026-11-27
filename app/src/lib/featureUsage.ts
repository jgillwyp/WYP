// Feature-usage tracking (2026-11-23, migration 103; expanded to cover
// every "Features worth trying" Checklist row, migration 104, same day) —
// Jim: "I am interested in automatically keeping track of app usage within
// Checklist (add a 'Add a Dialog entry'). This could potentially be used
// on an ongoing basis (and reported back for product development)." —
// then, once Dialog Entry alone was live: "the only feature I see tracked
// is Dialog Entry. I expected all features to be tracked." See migration
// 103's own header comment in docs/Week7+ - SQL history.txt for the full
// design (why a new table rather than reusing public.events, why a wide
// one-row-per-period admin report); migration 104 only widens the same
// table/functions, same shape, to the full feature list below.
//
// This type is the whole point of a shared file: every call site that logs
// a feature, plus TesterChecklistForm.tsx's own auto-check mapping, import
// it — so a typo in the feature key fails to compile instead of silently
// never matching anything on either end. Adding a new tracked feature
// needs, in order: a migration extending feature_usage.feature's own CHECK
// constraint and adding a column to admin_get_feature_usage() (same
// drop-then-create precedent every other RETURNS TABLE addition in this
// schema already uses), a new value added here, the real
// `log_feature_usage()` call wired in wherever that action happens, and
// (if it should drive a Checklist row) an entry added to
// TesterChecklistForm.tsx's own FEATURE_ITEM_ID map.
//
// One feature per Checklist "Features worth trying" row (dialog_entry
// excepted — it predates this expansion by a few hours, same list):
// request_created/todo_created (feat-1/feat-2), request_responded
// (feat-3, a signed-in recipient marking a Received Request Done —
// the anonymous /r/[token] path has no session to attribute to, same as
// dialog_entry), attachment_added (feat-4), voice_dictation (feat-5),
// receipt_confirmation (feat-receipt), request_texting (feat-texting),
// reminder_set (feat-6, Request-side only, matching that row's own
// "On a Request with a Due Date" wording), repeat_set (feat-7, Requests
// and ToDos both), calendar_view (feat-8, logged once per real mount —
// a view, not a save), archive_used (feat-9, Archive only, not UnArchive),
// print_used (feat-9b, wired once in platform.ts's own
// printWithExpandedWindow() rather than at each of the ~9 Print buttons,
// since they already all funnel through that one shared function).
export type TrackedFeature =
  | 'dialog_entry'
  | 'request_created'
  | 'todo_created'
  | 'request_responded'
  | 'attachment_added'
  | 'voice_dictation'
  | 'receipt_confirmation'
  | 'request_texting'
  | 'reminder_set'
  | 'repeat_set'
  | 'calendar_view'
  | 'archive_used'
  | 'print_used'

// Device-local checklist marks (2026-11-27) — Jim: the Tester Checklist
// should auto-check every item, with no manual checkboxes ("we keep track of
// what features you have used"), and "if it is needed to be kept on a
// per-account basis in the database for implementation, the usage information
// can stay in their browser - as it is now." The 13 features above are
// already logged per-account (feature_usage); these remaining checklist rows
// (sending Feedback, switching Free/Subscriber, a link opening the installed
// Android app) are recorded in this browser's localStorage instead, so no
// migration is needed. Read by TesterChecklistForm.tsx alongside
// get_my_feature_usage().
export type LocalChecklistMark = 'feedback_sent' | 'tier_toggled' | 'link_opened_app'

const LOCAL_MARKS_KEY = 'wyp.checklistLocalMarks'

export function readLocalChecklistMarks(): Set<LocalChecklistMark> {
  try {
    const raw = localStorage.getItem(LOCAL_MARKS_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(list) ? (list as LocalChecklistMark[]) : [])
  } catch {
    return new Set()
  }
}

export function markLocalChecklistUsage(mark: LocalChecklistMark) {
  try {
    const marks = readLocalChecklistMarks()
    if (marks.has(mark)) return
    marks.add(mark)
    localStorage.setItem(LOCAL_MARKS_KEY, JSON.stringify([...marks]))
  } catch {
    // Private window or blocked storage — the checklist just won't see it.
  }
}
