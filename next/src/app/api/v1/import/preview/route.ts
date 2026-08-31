// POST /api/v1/import/preview — 공유된 것 하나를 훑는다. 아무것도 저장하지 않는다.
// 여행을 지정하지 않는다: "어느 여행의 예약인가"를 짚어 주는 것이 이 요청의 목적이다.
import { handlers } from '../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handlers.importPreview(request);
}
