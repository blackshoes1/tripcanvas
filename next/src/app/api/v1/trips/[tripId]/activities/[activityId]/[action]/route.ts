// POST /api/v1/trips/:tripId/activities/:activityId/(complete|skip|reset)
// 여행 중 한 번의 터치로 끝나야 하므로, 응답에 바뀐 뒤의 Today를 함께 담아 재조회를 없앤다.
import { handlers } from '../../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ tripId: string; activityId: string; action: string }> }) {
  const { tripId, activityId, action } = await ctx.params;
  return handlers.activityAction(request, tripId, activityId, action);
}
