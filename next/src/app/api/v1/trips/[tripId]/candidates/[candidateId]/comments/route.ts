// GET·POST /api/v1/trips/:tripId/candidates/:candidateId/comments
// 코멘트는 **후보에만** 붙는다 — 일정의 장소에는 안정적인 id가 없다.
import { handlers } from '../../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ tripId: string; candidateId: string }> }) {
  const { tripId, candidateId } = await ctx.params;
  return handlers.comments(request, tripId, candidateId);
}

export async function POST(request: Request, ctx: { params: Promise<{ tripId: string; candidateId: string }> }) {
  const { tripId, candidateId } = await ctx.params;
  return handlers.addComment(request, tripId, candidateId);
}
