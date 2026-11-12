import type Stripe from 'stripe'

import { getAnnualPriceId, getMonthlyPriceId, getStorageAnnualPriceId, getStorageMonthlyPriceId } from '@/lib/stripe'
import type { SubscriptionCadence } from '@/lib/subscriptionPricing'

/**
 * Which base plan (Annual or Monthly) a live Stripe Subscription is on —
 * determined by which price id its own base item carries, the same way
 * update-storage/route.ts needed to know before this was factored out here,
 * now shared with plan-summary/route.ts too (2026-11-05). Returns null if
 * no item matches either known base price id (shouldn't happen for a real
 * subscription created through create-checkout-session/route.ts, but a
 * testing/manually-edited one could land here).
 */
export function resolveSubscriptionCadence(subscription: Stripe.Subscription): SubscriptionCadence | null {
  const annualPriceId = getAnnualPriceId()
  const monthlyPriceId = getMonthlyPriceId()
  const baseItem = subscription.items.data.find(
    (item) => item.price.id === annualPriceId || item.price.id === monthlyPriceId
  )
  if (!baseItem) return null
  return baseItem.price.id === annualPriceId ? 'annual' : 'monthly'
}

/**
 * The actual base-plan subscription item (not just its cadence) — needed
 * by upgrade-to-annual/route.ts and its own preview to swap the item's
 * price in place, same item id, rather than removing and re-adding one
 * (2026-11-12).
 */
export function findBaseSubscriptionItem(subscription: Stripe.Subscription): Stripe.SubscriptionItem | null {
  const annualPriceId = getAnnualPriceId()
  const monthlyPriceId = getMonthlyPriceId()
  return (
    subscription.items.data.find((item) => item.price.id === annualPriceId || item.price.id === monthlyPriceId) ??
    null
  )
}

/**
 * The Additional Storage subscription item, if one exists — update-storage/
 * route.ts already does this inline at its own one call site; factored out
 * here (2026-11-12) so upgrade-to-annual/route.ts can reuse it too, since an
 * upgrade has to also switch a storage item already on the subscription
 * from its Monthly price to the Annual one, not just the base plan item.
 */
export function findStorageSubscriptionItem(subscription: Stripe.Subscription): Stripe.SubscriptionItem | null {
  const storageMonthlyId = getStorageMonthlyPriceId()
  const storageAnnualId = getStorageAnnualPriceId()
  return (
    subscription.items.data.find((item) => item.price.id === storageMonthlyId || item.price.id === storageAnnualId) ??
    null
  )
}
