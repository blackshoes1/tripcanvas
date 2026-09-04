// 교차 출처 로그인 — 웹(정적)과 API가 다른 출처라, 자체 Auth 경로에도 CORS가 붙어야 한다.
// 2026-09-04: matcher가 /api/v1 만 덮어 /api/auth 의 preflight가 405가 났고 가입이 막혔다.
import { describe, expect, it } from 'vitest';

import { config, proxy } from './proxy';

const WEB = 'https://tripcanvas-ai.vercel.app';
const request = (url: string, method = 'GET', origin: string | null = WEB) =>
  ({ method, headers: new Headers(origin ? { origin } : {}) , url }) as unknown as Parameters<typeof proxy>[0];

describe('proxy(CORS)', () => {
  it('자체 Auth 경로도 matcher에 있다 — 없으면 로그인·가입이 통째로 막힌다', () => {
    expect(config.matcher).toContain('/api/auth/:path*');
    expect(config.matcher).toContain('/api/v1/:path*');
  });

  it('preflight는 204로 답하고 허용 출처를 그대로 돌려준다', () => {
    const res = proxy(request('https://api.test/api/auth/sign-up/email', 'OPTIONS'));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB);
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('모르는 출처에는 허용 헤더를 주지 않는다 — `*`를 쓰지 않는다', () => {
    const res = proxy(request('https://api.test/api/auth/sign-in/email', 'OPTIONS', 'https://evil.test'));
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
