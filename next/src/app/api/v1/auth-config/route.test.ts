// GET /api/v1/auth-config — 웹·iOS는 여기서 알린 소셜 로그인만 버튼으로 그린다.
// 그래서 네이버를 숨기는 곳도 여기 하나다: 키가 다 있어도 알리지 않는다(docs/social-login-setup.md).
import { expect, it, vi } from 'vitest';

vi.mock('../route-deps', () => ({ newAuthEnabled: true }));
vi.mock('@/server/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/config/env')>();
  const env = actual.parseEnv({
    OAUTH_GOOGLE_CLIENT_ID: 'g', OAUTH_GOOGLE_CLIENT_SECRET: 'g-secret-value', OAUTH_APPLE_CLIENT_ID: 'a', OAUTH_APPLE_CLIENT_SECRET: 'a-secret-value',
    OAUTH_NAVER_CLIENT_ID: 'n', OAUTH_NAVER_CLIENT_SECRET: 'n-secret-value', OAUTH_KAKAO_CLIENT_ID: 'k', OAUTH_KAKAO_CLIENT_SECRET: 'k-secret-value'
  });
  return { ...actual, getEnv: () => env };
});

it('announces every configured provider except Naver, without caching', async () => {
  const { GET } = await import('./route');
  const response = await GET();
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  // 토큰 없이 답하는 곳이라 몸통 전체를 고정한다 — 제공자 설정을 싣는 필드가 하나라도 늘면 여기서 깨진다
  expect(body).toEqual({ provider: 'TRIPCANVAS', passwordResetRequiredForLegacyUsers: true, socialProviders: ['google', 'apple', 'kakao'] });
  expect(JSON.stringify(body)).not.toMatch(/secret-value|clientSecret|naver/);
});
