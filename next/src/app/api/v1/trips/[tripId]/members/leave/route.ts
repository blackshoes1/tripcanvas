// POST /api/v1/trips/:tripId/members/leave — 나가기(소유자는 못 나간다). 멱등
import { collabRoutes } from '../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return collabRoutes.leave(request, tripId);
}
