// GET /api/v1/trips/:tripId/candidates — 후보 보드(반응 집계·내 반응·코멘트 수) · POST — 후보 추가(OWNER·EDITOR)
import { collabRoutes } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return collabRoutes.listCandidates(request, tripId);
}

export async function POST(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return collabRoutes.addCandidate(request, tripId);
}
