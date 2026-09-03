// GET /api/v1/trips/:tripId/preferences — 멤버들의 여행 취향 · PUT { prefs } — 내 취향(정규화된 결과를 돌려준다)
import { collabRoutes } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return collabRoutes.listPreferences(request, tripId);
}

export async function PUT(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return collabRoutes.setPreference(request, tripId);
}
