// 요청 전처리(Next 16에서 middleware가 proxy로 바뀌었다). 하는 일은 하나다: /api/v1의 교차 출처 허용(§72).
//
// 정적 웹(tripcanvas-ai.vercel.app)이 Supabase 대신 이 API를 부르기 시작하면서 필요해졌다.
// proxy는 렌더 코드와 분리돼 돌 수 있으므로 무거운 모듈을 끌어오지 않는다 — 순수 함수 하나만 쓴다.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { corsHeadersFor, preflightResponse, readAllowedOrigins } from '@/server/api/cors';

export function proxy(request: NextRequest): Response {
  const origin = request.headers.get('origin');
  const allowed = readAllowedOrigins(process.env);

  if (request.method === 'OPTIONS') return preflightResponse(origin, allowed);

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeadersFor(origin, allowed))) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  // ⚠️ 자체 Auth(`/api/auth/*`)도 반드시 포함한다. 라우트가 GET·POST만 내보내므로
  // 여기서 안 받으면 preflight(OPTIONS)가 405가 되고, 브라우저는 그것을 '네트워크 오류'로 보여 준다 —
  // 웹과 API가 다른 출처인 한 로그인·가입이 통째로 막힌다(2026-09-04에 실제로 그랬다).
  matcher: ['/api/v1/:path*', '/api/auth/:path*']
};
