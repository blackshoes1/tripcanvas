// GET /api/v1/trips/:tripId/candidates/:candidateId/comments · POST { body } — 의견이라 보기 권한도 남긴다
import { collabRoutes } from '../../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string; candidateId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { tripId, candidateId } = await ctx.params;
  return collabRoutes.listComments(request, tripId, candidateId);
}

export async function POST(request: Request, ctx: Ctx) {
  const { tripId, candidateId } = await ctx.params;
  return collabRoutes.addComment(request, tripId, candidateId);
}
