// 명소 한 곳의 예약 요건·참고 가격 연결 상태. 실제 값이 없으면 UNKNOWN/NOT_CONNECTED다.
import { placeRoutes } from '../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return placeRoutes.details(request);
}
