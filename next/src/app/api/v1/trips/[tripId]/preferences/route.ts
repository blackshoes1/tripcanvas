// GET·PUT /api/v1/trips/:tripId/preferences
// 취향은 **여행별**이다(§18). 본인 것만 바꾸고, 저장 뒤에는 서버가 정규화해 돌려준 값이 이긴다.
import { handlers } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.preferences(request, tripId);
}

export async function PUT(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.savePreferences(request, tripId);
}
