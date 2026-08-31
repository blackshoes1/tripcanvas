// POST /api/v1/trips/:tripId/import/commit — 사용자가 확인한 후보만 저장한다.
// 저장으로 끝내지 않고 새 예약이 남은 일정과 부딪히는지(replan)까지 함께 돌려준다.
import { handlers } from '../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.importCommit(request, tripId);
}
