// 주기 가격 추적 cron — Phase 3 이관 3호 (§13). CRON_SECRET 인증·starvation 방지 정렬(P1-1)·
// basis 강등(P0-1)·비용 제어(실행 상한·당일 중복 제외·요청 공유)를 레거시 단일 소스로 실행한다.
// 프로덕션 cron은 아직 vercel.json → 레거시 함수로 간다. Next 인수 시 같은 경로라 crons 설정은 그대로다.
import legacyHandler from '@legacy/api/track-hotel-prices.js';

import { toRouteHandler } from '@/lib/legacy/nodeHandler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;         // vercel.json의 레거시 함수 설정과 동일

const handle = toRouteHandler(legacyHandler);

export async function GET(request: Request) {
  return handle(request);
}
