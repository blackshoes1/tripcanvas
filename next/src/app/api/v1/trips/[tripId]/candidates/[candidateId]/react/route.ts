// POST /api/v1/trips/:tripId/candidates/:candidateId/react
// 반응은 활성 멤버 전원이 낸다 — 보기 권한도 의견은 말한다(§12). reaction이 없으면 거둔다.
import { handlers } from '../../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ tripId: string; candidateId: string }> }) {
  const { tripId, candidateId } = await ctx.params;
  return handlers.reactCandidate(request, tripId, candidateId);
}
