// PATCH /api/v1/trips/:tripId/members/:memberId — { action: SET_ROLE|REMOVE|RENAME, value }
import { collabRoutes } from '../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string; memberId: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { tripId, memberId } = await ctx.params;
  return collabRoutes.manageMember(request, tripId, memberId);
}
