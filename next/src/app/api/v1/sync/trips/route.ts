// GET /api/v1/sync/trips — 클라이언트 동기화용 전체 조회.
// /trips(요약)와 다른 점 둘: 여행 **문서를 통째로** 주고, **삭제(tombstone)된 것도** 준다.
// 둘 다 로그인 병합에 필요하다 — 다른 기기가 지운 여행을 알아야 로컬에서도 지운다.
import { tripRoutes } from '../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return tripRoutes.syncList(request);
}
