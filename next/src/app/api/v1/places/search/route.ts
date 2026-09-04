// GET /api/v1/places/search — 국내 장소 검색(카카오 로컬) 프록시. 로직은 server/api/placeRoutes.ts.
import { placeRoutes } from '../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return placeRoutes.search(request);
}
