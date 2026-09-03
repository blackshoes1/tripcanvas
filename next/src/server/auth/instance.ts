// 자체 Auth 인스턴스 조립 — 환경이 갖춰졌을 때만 만든다(§57).
// AUTH_SECRET이 없거나 DATABASE_URL이 없으면 **null**이다: 자체 Auth는 꺼진 채로 두고 Supabase 경로만 돈다.
// 그래서 오늘의 Vercel 배포는 이 파일이 있어도 아무것도 달라지지 않는다.
import { getEnv } from '../config/env';
import { getDb } from '../infrastructure/database/client';
import { PgAuthIdentityRepository } from '../infrastructure/database/pgAuthIdentityRepository';
import { PgMailCooldownStore } from '../infrastructure/database/pgMailCooldownStore';
import { withCooldown } from '../infrastructure/mail/cooldownMailService';
import { createConsoleMailService, createSmtpMailService } from '../infrastructure/mail/smtpMailService';
import type { MailService } from '../infrastructure/mail/types';
import { createBetterAuth, type BetterAuthInstance } from './betterAuth';
import { createBetterAuthVerifier } from './betterAuthVerifier';
import type { TokenVerifier } from './types';

export interface NewAuth {
  auth: BetterAuthInstance;
  verifier: TokenVerifier;
}

/** 인증·재설정 메일은 하루에도 여러 번 눌릴 수 있다 — 같은 종류는 이 간격 안에서 한 번만 나간다(§67) */
const MAIL_COOLDOWN_MS = 60_000;

let cached: NewAuth | null | undefined;

export function getNewAuth(): NewAuth | null {
  if (cached !== undefined) return cached;
  const env = getEnv();
  const db = getDb();
  if (!env.newAuthEnabled || !env.authSecret || !db) {
    cached = null;
    return cached;
  }
  const base: MailService = env.smtp
    ? createSmtpMailService(env.smtp)
    : createConsoleMailService((m) => console.log(`[tripcanvas-api] SMTP 미설정 — ${m}`));
  const mail = withCooldown(base, new PgMailCooldownStore(db), {
    cooldownMs: MAIL_COOLDOWN_MS,
    log: (m) => console.log(`[tripcanvas-api] ${m}`)
  });
  const auth = createBetterAuth({
    db, mail, secret: env.authSecret, baseURL: env.apiBaseUrl, trustedOrigins: env.trustedOrigins
  });
  cached = { auth, verifier: createBetterAuthVerifier(auth, new PgAuthIdentityRepository(db)) };
  return cached;
}
