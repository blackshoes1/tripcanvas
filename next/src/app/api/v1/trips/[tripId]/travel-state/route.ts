// GET /api/v1/trips/:tripId/travel-state
// 여행 중 화면·잠금화면·위젯이 쓰는 단 하나의 조회. 연속 호출을 없애 배터리를 아낀다(§57).
//   ?lat=&lng=&locUpdatedAt=   현재 위치 (이번 계산에만 쓰고 저장하지 않는다)
//   ?travelMode=1              Travel Mode 켜짐 — 먼저 말 걸어도 되는 상태
//   ?suppressUntil=HH:MM       "오늘은 쉬기" 이후의 침묵 구간
//   ?markSent=1                돌려준 알림을 보낸 것으로 기록 (같은 상황 반복 방지)
import { handlers } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.travelState(request, tripId);
}
