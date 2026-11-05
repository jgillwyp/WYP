import Stripe from 'stripe'

/**
 * Server-only Stripe helpers — imported only from app/api/stripe/*
 * route.ts files, never from a 'use client' component. Mirrors the
 * must()/getServiceRoleClient() posture app/api/attachments/_shared.ts
 * already established for a different third-party credential: fail loud
 * and specific at call time rather than silently no-op, since a missing
 * Stripe key here means real money can't move, not a cosmetic gap.
 */

function must(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `[WYP] Missing environment variable ${name}. Set it in Vercel under ` +
        `Settings -> Environment Variables (Production and Preview scopes), ` +
        `then redeploy; or add it to .env.local for local development. See ` +
        `docs/stripe-setup.mjs for how to produce the Price/Coupon ids.`
    )
  }
  return value
}

let cached: Stripe | null = null

export function getStripeClient(): Stripe {
  if (!cached) {
    cached = new Stripe(must('STRIPE_SECRET_KEY'))
  }
  return cached
}

/** Price ids created once by docs/stripe-setup.mjs and pasted into env. */
export function getAnnualPriceId(): string {
  return must('STRIPE_PRICE_ANNUAL')
}
export function getMonthlyPriceId(): string {
  return must('STRIPE_PRICE_MONTHLY')
}

/** Additional-storage price ids (2026-11-04) — each a recurring, per-unit
 * ("per 5 GB block") price riding the SAME subscription and billing cycle
 * as the base plan, rather than a separate one-time purchase. Which one
 * applies is determined by which base price the caller's own subscription
 * item is on (see update-storage/route.ts), never by anything the client
 * sends. */
export function getStorageMonthlyPriceId(): string {
  return must('STRIPE_PRICE_STORAGE_MONTHLY')
}
export function getStorageAnnualPriceId(): string {
  return must('STRIPE_PRICE_STORAGE_ANNUAL')
}

/** Coupon ids, both duration:'once' so each only discounts the very first
 * invoice of a new annual subscription — every renewal after that bills
 * the plain $49/yr price with no coupon involved. */
export function getFirstYearCouponId(): string {
  return must('STRIPE_COUPON_FIRST_YEAR')
}
export function getTesterFirstYearCouponId(): string {
  return must('STRIPE_COUPON_TESTER_FIRST_YEAR')
}

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wouldyouplease.com'
}
