// GET /api/v1/trips/:tripId/days/:dayIndex — 일정 화면이 쓰는 하루치.
//
// Today가 "지금 무엇을"이라면 이쪽은 "그 날 전체가 어떻게 흐르는가"다.
// 계산은 `dayView.ts`(→ `lib.js`)가 이미 하고 있고, 여기서 규칙을 새로 만들지 않는다.
import { handlers } from '../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ tripId: string; dayIndex: string }> }) {
  const { tripId, dayIndex } = await ctx.params;
  return handlers.dayPlan(request, tripId, Number(dayIndex));
}
