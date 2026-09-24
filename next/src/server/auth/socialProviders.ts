import type { BetterAuthOptions } from 'better-auth';

export const SOCIAL_PROVIDERS = ['google', 'apple', 'naver', 'kakao'] as const;
export type SocialProvider = typeof SOCIAL_PROVIDERS[number];
export type SocialProviders = NonNullable<BetterAuthOptions['socialProviders']>;

/** 비밀은 서버에만 둔다. 일부 값만 설정된 제공자는 노출하지 않는다. */
export function readSocialProviders(env: Record<string, string | undefined>): SocialProviders {
  const result: SocialProviders = {};
  for (const provider of SOCIAL_PROVIDERS) {
    const prefix = `OAUTH_${provider.toUpperCase()}`;
    const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
    if (clientId && clientSecret) result[provider] = { clientId, clientSecret, requireEmailVerification: true };
  }
  return result;
}

export function enabledSocialProviders(providers: SocialProviders): SocialProvider[] {
  return SOCIAL_PROVIDERS.filter(provider => !!providers[provider]);
}
