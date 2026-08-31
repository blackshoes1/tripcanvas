// GET /api/v1/trips — 로그인한 사용자의 여행 목록 (웹에서 만든 여행이 그대로 보인다)
import { handlers } from '../route-deps';

export const runtime = 'nodejs';          // adaptive.js/lib.js는 CJS — Edge 불가
export const dynamic = 'force-dynamic';   // 사용자별 응답, 캐시 금지

export async function GET(request: Request) {
  return handlers.trips(request);
}
