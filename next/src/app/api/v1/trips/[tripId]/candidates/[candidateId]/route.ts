// PATCH /api/v1/trips/:tripId/candidates/:candidateId — { action: REMOVE|SCHEDULE|UNSCHEDULE|REJECT|REOPEN, value }
import { collabRoutes } from '../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string; candidateId: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { tripId, candidateId } = await ctx.params;
  return collabRoutes.manageCandidate(request, tripId, candidateId);
}
