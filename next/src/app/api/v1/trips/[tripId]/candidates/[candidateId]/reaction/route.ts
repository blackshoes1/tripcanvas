// PUT /api/v1/trips/:tripId/candidates/:candidateId/reaction — { reaction: MUST|OK|PASS|null } 한 사람 한 표, null이면 거두기
import { collabRoutes } from '../../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string; candidateId: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  const { tripId, candidateId } = await ctx.params;
  return collabRoutes.react(request, tripId, candidateId);
}
