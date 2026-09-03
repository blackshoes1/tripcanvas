// /api/auth/* — 자체 Auth(가입·이메일 확인·로그인·로그아웃·세션·비밀번호 재설정). 라이브러리가 전부 처리한다(§18).
// AUTH_SECRET·DATABASE_URL이 없으면 꺼져 있다: 404를 준다. 오늘의 배포에서는 이 경로가 열리지 않는다.
import { errorResponse, ApiError } from '@/server/api/errors';
import { getNewAuth } from '@/server/auth/instance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function handle(request: Request): Promise<Response> {
  const newAuth = getNewAuth();
  if (!newAuth) return Promise.resolve(errorResponse(new ApiError('NOT_FOUND', { message: '자체 로그인이 아직 켜져 있지 않습니다.' })));
  return newAuth.auth.handler(request);
}

export const GET = handle;
export const POST = handle;
