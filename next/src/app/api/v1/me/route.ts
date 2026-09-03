// GET /api/v1/me — 내 역할·인원과 어느 실시간을 쓸지. 로그인 직후와 역할 갱신 때 부른다(my_trip_roles 대체).
import { meRoutes } from '../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return meRoutes.me(request);
}
