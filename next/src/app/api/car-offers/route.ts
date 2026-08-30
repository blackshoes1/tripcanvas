// 렌터카 시장가 프록시 — Phase 3 이관 2호 (§13: API 하나씩).
// hotel-offers와 같은 어댑터 방식: Provider 레지스트리·자격증명 관측(P0-2)·요청 검증·
// rate limit·오류 분류를 레거시 api/car-offers.js 단일 소스로 실행한다.
// 프로덕션은 아직 레거시 Vercel 함수가 서빙한다.
import legacyHandler from '@legacy/api/car-offers.js';

import { toRouteHandler } from '@/lib/legacy/nodeHandler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = toRouteHandler(legacyHandler);

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
