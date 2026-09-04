// GET  /api/v1/trips/:tripId/prices — 그 여행의 가격 관측(오래된 순)
// POST /api/v1/trips/:tripId/prices — 관측 한 건 남기기(append-only)
//
// 예전에는 웹이 hotel_price_snapshots 를 Supabase에서 직접 읽고 썼다. 여행이 새 DB로 옮겨진 뒤에도
// 그 경로만 남아 있으면 데이터가 두 곳으로 갈린다 — 그래서 이 라우트로 모은다.
import { handlers } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.prices(request, tripId);
}

export async function POST(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.createPrice(request, tripId);
}
