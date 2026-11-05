import { getForwardedClient, getOwnerStorageStatus, getServiceRoleClient } from '../_shared'

export const runtime = 'nodejs'

/**
 * POST /api/attachments/usage — a lightweight owner-scoped usage read,
 * built 2026-11-04 for AttachmentStoragePanel (SubscriptionPanels.tsx) so
 * it can show the real storage floor ("can't go below what's already used")
 * before the account tries an update-storage call. Deliberately separate
 * from owner-summary/route.ts, which also returns usedBytes but additionally
 * lists every attachment with signed view/download URLs — unnecessary work
 * (and unnecessary signed-URL generation) just to show one number on a
 * screen that renders every time Account Options or /account/subscription
 * does.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const forwarded = getForwardedClient(authHeader)
  const { data: userData } = await forwarded.auth.getUser()
  if (!userData.user) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const admin = getServiceRoleClient()
  const { usedBytes, limitBytes, tier } = await getOwnerStorageStatus(admin, userData.user.id)

  return Response.json({ usedBytes, limitBytes, tier })
}
