// GET /api/v1/trips/:tripId/activity — 최근 활동. 묶기와 문장 만들기를 서버에서 끝낸다(§38·§39)
import { handlers } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.activity(request, tripId);
}
