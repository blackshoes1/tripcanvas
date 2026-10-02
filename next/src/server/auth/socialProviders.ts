import type { BetterAuthOptions } from 'better-auth';

/**
 * 켜는 소셜 로그인. 이 목록이 better-auth 설정·`/api/auth/social/start` 허용·`auth-config` 알림을 모두 정한다 —
 * 웹·iOS는 알린 것만 버튼으로 그린다.
 *
 * ⚠️ **네이버는 뺐다**(2026-10-02). better-auth의 네이버 매핑은 `emailVerified`를 언제나 false로 주는데,
 * 우리는 **확인된 이메일로만** 계정을 잇는다(`requireEmailVerification` · `finishSocialLogin` · `trustedProviders: []`).
 * 그래서 이메일로 가입한 사람은 네이버로 늘 실패하고, 처음 온 사람도 확인 메일을 거쳐 한 번 더 해야 한다.
 * 신뢰 규칙을 풀지 않고 버튼을 숨겼다. 키가 있어도 읽지 않는다 — 되돌리는 조건은 docs/social-login-setup.md.
 */
export const SOCIAL_PROVIDERS = ['google', 'apple', 'kakao'] as const;
export type SocialProvider = typeof SOCIAL_PROVIDERS[number];
export type SocialProviders = NonNullable<BetterAuthOptions['socialProviders']>;

/** 비밀은 서버에만 둔다. 일부 값만 설정된 제공자는 노출하지 않는다. */
export function readSocialProviders(env: Record<string, string | undefined>, warn?: (m: string) => void): SocialProviders {
  const result: SocialProviders = {};
  for (const provider of SOCIAL_PROVIDERS) {
    const prefix = `OAUTH_${provider.toUpperCase()}`;
    const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
    if (clientId && clientSecret) result[provider] = { clientId, clientSecret, requireEmailVerification: true };
  }
  // 키를 넣고도 버튼이 안 보이면 설정이 틀린 줄 안다 — 일부러 읽지 않는다는 것을 남긴다.
  // 지우라고까지 말한다: 숨기기 전 이미지로 롤백하면 그 이미지는 이 키를 다시 읽어 네이버가 켜진다
  if (env.OAUTH_NAVER_CLIENT_ID?.trim() || env.OAUTH_NAVER_CLIENT_SECRET?.trim()) {
    warn?.('OAUTH_NAVER_* 값을 읽지 않는다 — 네이버는 이메일 확인 여부를 주지 않아 로그인을 숨겨 두었다. ' +
      '.env에서 지울 것: 숨기기 전 이미지로 롤백하면 다시 켜진다(docs/social-login-setup.md)');
  }
  return result;
}

export function enabledSocialProviders(providers: SocialProviders): SocialProvider[] {
  return SOCIAL_PROVIDERS.filter(provider => !!providers[provider]);
}
