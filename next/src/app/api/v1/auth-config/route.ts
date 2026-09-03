// GET /api/v1/auth-config — 무엇으로 로그인하는지. **토큰 없이** 답한다(로그인 전에 알아야 한다).
// 비밀은 싣지 않는다: 제공자 이름과, 예전 계정이 비밀번호를 새로 정해야 하는지뿐이다.
import { resolveAuthProvider } from '@/server/api/authConfig';
import { newAuthEnabled } from '../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(resolveAuthProvider(newAuthEnabled), {
    // 전환 시점에 옛 답이 남아 있으면 로그인이 통째로 막힌다 — 캐시하지 않는다
    headers: { 'cache-control': 'no-store' }
  });
}
