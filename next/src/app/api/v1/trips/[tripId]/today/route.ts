// GET /api/v1/trips/:tripId/today — iOS의 중심 화면이 쓰는 단 하나의 조회.
// 현재 상태·다음 행동·제안·남은 일정·재구성 미리보기를 한 번에 준다(왕복 횟수가 곧 체감 속도다).
import { handlers } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.today(request, tripId);
}
