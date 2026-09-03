// 자체 Auth(Phase 8, §17·§18). 비밀번호 해시·세션 토큰·인증/재설정 토큰을 **직접 설계하지 않는다** —
// 검증된 라이브러리(better-auth)가 만들고 검증하며, 우리는 정책만 정한다.
//
// 정책:
//   · 이메일 확인 전에는 로그인이 열리지 않는다(requireEmailVerification) — 계정 연결(identity.ts)의 전제이기도 하다
//   · 세션은 웹(쿠키)과 iOS(bearer)가 함께 쓴다(§70) — bearer 플러그인이 Authorization 헤더를 받아 준다
//   · rate limit은 DB 저장소(§66) — 재시작에도 유지된다. 메일 반복 발송은 따로 쿨다운으로 막는다(§67)
//   · 메일은 교체 가능한 어댑터로 주입한다(§21) — 이 파일은 SMTP를 모른다
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins/bearer';

import type { Db } from '../infrastructure/database/db';
import type { MailService } from '../infrastructure/mail/types';
import {
  authAccount, authRateLimit, authSession, authUser, authVerification
} from '../infrastructure/database/schema';

export interface BetterAuthOptions {
  db: Db;
  mail: MailService;
  /** 서명·암호화 비밀(§57). 없으면 만들지 않는다 — 조용히 약한 기본값을 쓰지 않는다 */
  secret: string;
  baseURL: string;
  /** 브라우저에서 이 API를 부르는 출처(§72). `*`를 쓰지 않는다 */
  trustedOrigins?: string[];
}

export function createBetterAuth(opts: BetterAuthOptions) {
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    basePath: '/api/auth',
    ...(opts.trustedOrigins?.length ? { trustedOrigins: opts.trustedOrigins } : {}),
    database: drizzleAdapter(opts.db, {
      provider: 'pg',
      schema: {
        auth_user: authUser,
        auth_session: authSession,
        auth_account: authAccount,
        auth_verification: authVerification,
        auth_rate_limit: authRateLimit
      }
    }),
    user: { modelName: 'auth_user' },
    session: { modelName: 'auth_session' },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification' },
    emailAndPassword: {
      enabled: true,
      // 확인되지 않은 이메일로는 로그인할 수 없다 — 남의 이메일로 가입해 그 사람의 여행을 가져가는 길을 막는다
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => { await opts.mail.sendPasswordReset(user.email, url); }
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => { await opts.mail.sendVerificationEmail(user.email, url); }
    },
    // iOS는 쿠키를 쓰지 않는다 — Authorization: Bearer <session token>으로 같은 세션을 쓴다(§70)
    plugins: [bearer()],
    rateLimit: { enabled: true, storage: 'database', modelName: 'auth_rate_limit' }
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
