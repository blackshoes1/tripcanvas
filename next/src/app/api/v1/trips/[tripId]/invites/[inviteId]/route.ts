// DELETE /api/v1/trips/:tripId/invites/:inviteId — 초대 취소(멱등)
import { collabRoutes } from '../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string; inviteId: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  const { tripId, inviteId } = await ctx.params;
  return collabRoutes.revokeInvite(request, tripId, inviteId);
}
