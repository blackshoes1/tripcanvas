// GET /api/v1/trips/:tripId/activity?limit=40 — 최근 활동(문장은 클라이언트가 collab.js activityText로 만든다)
import { collabRoutes } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return collabRoutes.listActivity(request, tripId);
}
