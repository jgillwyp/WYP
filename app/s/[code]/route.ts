import { createClient } from '@supabase/supabase-js'

// Supabase client creation needs Node, not Edge, same reasoning every other
// server-only Supabase route in this app already gives.
export const runtime = 'nodejs'

/**
 * GET /s/[code] — short-link redirect for Request Texting SMS links
 * (migration 081, 2026-10-19). public.short_links is openly SELECT-able
 * (anon + authenticated), so this uses the ordinary anon-key client, same
 * as every other anonymous-reachable page in this app — no service_role
 * needed here, since reading this table was never gated the way the real
 * /r/[token] lookup is (that gating lives on the request_links table this
 * short link ultimately points at, not on the short code itself).
 *
 * Every short_links row's target_url was validated against the
 * wouldyouplease.com origin at creation time by create_short_link() —
 * this route trusts that invariant rather than re-validating, since
 * nothing here can ever write a row, only read one.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response('Not found.', { status: 404 })
  }

  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const { data } = await sb.from('short_links').select('target_url').eq('code', code).single()
  if (!data?.target_url) {
    return new Response('Not found.', { status: 404 })
  }

  return Response.redirect(data.target_url, 302)
}
