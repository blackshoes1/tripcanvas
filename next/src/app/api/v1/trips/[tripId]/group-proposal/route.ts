// GET /api/v1/trips/:tripId/group-proposal — 반대 없는 후보를 어느 날에 넣을지 미리보기(§28·§29·§35).
// 저장하지 않는다 — 수락은 사람이 누른다.
import { collabRoutes } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return collabRoutes.groupProposal(request, tripId);
}
