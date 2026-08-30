// 호텔 시세 프록시 — Phase 3 이관 1호 (§13: API 하나씩).
// 구현의 단일 출처는 레거시 api/hotel-offers.js 그대로다: 요청 검증·identity 매칭·오퍼 정규화·
// basis(P0-1)·Provider 상태(P0-2)·rate limit·오류 분류까지 전부 포함해 어댑터로 실행한다.
// 프로덕션은 아직 레거시 Vercel 함수가 서빙한다 — Next가 배포되는 시점에 이 라우트가 넘겨받는다.
import legacyHandler from '@legacy/api/hotel-offers.js';

import { toRouteHandler } from '@/lib/legacy/nodeHandler';

export const runtime = 'nodejs';       // 레거시 모듈은 CJS + Buffer 사용 — Edge 불가
export const dynamic = 'force-dynamic';
export const maxDuration = 25;         // vercel.json의 레거시 함수 설정과 동일

const handle = toRouteHandler(legacyHandler);

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
