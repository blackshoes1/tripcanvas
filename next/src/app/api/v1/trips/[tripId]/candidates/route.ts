// GET  /api/v1/trips/:tripId/candidates — 후보 보드 한 장(묶음·배지·충돌 선택지·그룹 제안·취향 요약)
// POST /api/v1/trips/:tripId/candidates — 후보 추가. 응답은 바뀐 보드 그대로다(왕복을 아낀다)
import { handlers } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.candidates(request, tripId);
}

export async function POST(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.addCandidate(request, tripId);
}
