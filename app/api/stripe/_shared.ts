import type Stripe from 'stripe'

import { getAnnualPriceId, getMonthlyPriceId } from '@/lib/stripe'
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
