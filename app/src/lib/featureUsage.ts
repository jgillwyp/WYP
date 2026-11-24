// Feature-usage tracking (2026-11-23, migration 103) — Jim: "I am
// interested in automatically keeping track of app usage within Checklist
// (add a 'Add a Dialog entry'). This could potentially be used on an
// ongoing basis (and reported back for product development)." See that
// migration's own header comment in docs/Week7+ - SQL history.txt for the
// full design (why a new table rather than reusing public.events, why a
// wide one-row-per-period admin report).
//
// This one-line type is the whole point of a shared file: every call site
// that logs a feature, plus TesterChecklistForm.tsx's own auto-check
// mapping, import it — so a typo in the feature key fails to compile
// instead of silently never matching anything on either end. Adding a new
// tracked feature needs, in order: a migration extending
// feature_usage.feature's own CHECK constraint and adding a column to
// admin_get_feature_usage() (same drop-then-create precedent every other
// RETURNS TABLE addition in this schema already uses), a new value added
// here, the real `log_feature_usage()` call wired in wherever that action
// happens, and (if it should drive a Checklist row) an entry added to
// TesterChecklistForm.tsx's own FEATURE_ITEM_ID map.
export type TrackedFeature = 'dialog_entry'
