// 카카오내비 프록시 — Phase 6a (경로 조회 이관). 서버 전용 KAKAO_REST_API_KEY 보호.
// 구현의 단일 출처는 레거시 api/kakao-directions.js 그대로다: 좌표 검증·same-origin·
// rate limit·업스트림 타임아웃·응답 위생(safeRoute)까지 전부 포함해 어댑터로 실행한다.
// 프로덕션은 아직 레거시 Vercel 함수가 서빙한다 — Next가 배포되는 시점에 이 라우트가 넘겨받는다.
import legacyHandler from '@legacy/api/kakao-directions.js';

import { toRouteHandler } from '@/lib/legacy/nodeHandler';

export const runtime = 'nodejs';       // 레거시 모듈은 CJS + Buffer 사용 — Edge 불가
export const dynamic = 'force-dynamic';

const handle = toRouteHandler(legacyHandler);

export async function POST(request: Request) {
  return handle(request);
}
