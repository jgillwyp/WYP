/**
 * Shared subscription pricing — one source for the numbers shown in
 * SubscriptionPanels.tsx and the amounts actually charged by the
 * app/api/stripe/* routes, so the displayed price and the charged price
 * can never drift apart. Built 2026-11-04 alongside the real Stripe
 * integration (migration 088) — the dollar figures themselves are
 * unchanged from the 2026-10-13 repricing, just moved out of
 * SubscriptionPanels.tsx so server code can import them too (a client
 * component can't be imported from a route handler).
 *
 * Client-safe — no Supabase/Stripe imports here, just numbers and plain
 * date math, so this can be imported from both 'use client' components and
 * server-only route handlers without pulling either runtime's SDK into the
 * wrong bundle.
 */

export const ANNUAL_FIRST_YEAR_PRICE = 39
export const ANNUAL_RENEWAL_PRICE = 49
export const TESTER_FIRST_YEAR_PRICE = 19
export const MONTHLY_PRICE = 5

export type SubscriptionPlan = 'annual' | 'monthly'

// Where a Stripe Checkout/Billing Portal hand-off should return to once it's
// done (2026-11-11, owner-reported: "private tester Stripe session returns
// to Account Options instead of to the private tester 'account' screen") —
// create-checkout-session/create-portal-session route.ts had always
// hardcoded /account/subscription regardless of which AccountStatusSection
// call site actually started the flow. Each caller now passes its own real
// path; both the route handlers and /stripe-return/page.tsx validate
// against this exact allowlist (never trust an arbitrary client-supplied
// path as a redirect target) and fall back to /account/subscription on
// anything else. '/admin/stripe-test' dropped the same day, once the
// Account Status merge retired that screen entirely (AdminTestStripeForm.tsx
// deleted) — a private tester now reaches the same real Stripe controls
// directly on Account Options/the full-page screen.
export const STRIPE_RETURN_PATHS = ['/account', '/account/subscription'] as const
export type StripeReturnPath = (typeof STRIPE_RETURN_PATHS)[number]
export function sanitizeStripeReturnPath(value: unknown): StripeReturnPath {
  return (STRIPE_RETURN_PATHS as readonly string[]).includes(value as string)
    ? (value as StripeReturnPath)
    : '/account/subscription'
}

// Parses a plain YYYY-MM-DD as a local calendar date, not a UTC instant —
// moved here verbatim from SubscriptionPanels.tsx (2026-08-26), same
// reasoning as every other bare "date" field in this app (Due Date, Done
// Date, Before Done Date): the displayed/charged day must never shift a
// day earlier/later depending on the server's or viewer's own time zone.
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

// Additional storage, redesigned 2026-11-04 from a one-time purchase into a
// genuine recurring add-on: it rides the SAME Stripe Subscription and
// billing cycle as the base plan (a second subscription item), rather than
// a separate payment. Jim's own design: "it is offered at $1/mo for each
// incremental 5GBs... [or] Annual additional $12/5GB... That way the period
// doesn't matter and there are no periodic incremental charges - there is
// just a higher rate." The old "$6 if <6 months remain" wrinkle is handled
// by Stripe's own native day-by-day proration when a block is added
// mid-cycle (Jim's confirmed choice over hand-rolling a flat 2-tier rate),
// not by any logic here.
export const STORAGE_BLOCK_GB = 5
export const STORAGE_MONTHLY_RATE_PER_BLOCK = 1
export const STORAGE_ANNUAL_RATE_PER_BLOCK = 12

export type SubscriptionCadence = 'annual' | 'monthly'

export function storageRatePerBlock(cadence: SubscriptionCadence): number {
  return cadence === 'annual' ? STORAGE_ANNUAL_RATE_PER_BLOCK : STORAGE_MONTHLY_RATE_PER_BLOCK
}

// A reduction is allowed, per Jim, but never below whatever is actually
// occupied right now — rounds usage up to the next whole 5 GB block, floored
// at the base 5 GB every account already has. GB_BYTES matches
// getOwnerStorageStatus()'s own 1024-based unit (app/api/attachments/
// _shared.ts) so the two never disagree on where the line falls.
const GB_BYTES = 1024 * 1024 * 1024

export function minAllowedStorageGb(usedBytes: number): number {
  const usedBlocks = Math.ceil(usedBytes / (STORAGE_BLOCK_GB * GB_BYTES))
  return Math.max(STORAGE_BLOCK_GB, usedBlocks * STORAGE_BLOCK_GB)
}
