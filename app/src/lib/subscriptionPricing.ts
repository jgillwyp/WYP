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

// Parses a plain YYYY-MM-DD as a local calendar date, not a UTC instant —
// moved here verbatim from SubscriptionPanels.tsx (2026-08-26), same
// reasoning as every other bare "date" field in this app (Due Date, Done
// Date, Before Done Date): the displayed/charged day must never shift a
// day earlier/later depending on the server's or viewer's own time zone.
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

// Buy-Add'l pricing rule, confirmed with Jim: less than 6 months remaining
// until the Renewal Date -> $5 per 5 GB block (discounted); otherwise $10
// per 5 GB block. No known Renewal Date reads as the normal, undiscounted
// rate.
export function isWithinSixMonths(renewalDate: string | null): boolean {
  if (!renewalDate) return false
  const sixMonthsOut = new Date()
  sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6)
  return parseIsoDate(renewalDate).getTime() <= sixMonthsOut.getTime()
}

export function computeAddlStoragePrice(renewalDate: string | null, targetGb: 5 | 10): number {
  const perBlock = isWithinSixMonths(renewalDate) ? 5 : 10
  return (targetGb / 5) * perBlock
}
