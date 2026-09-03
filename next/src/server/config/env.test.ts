import { describe, expect, it } from 'vitest';

import { parseEnv } from './env';

describe('parseEnv', () => {
  it('아무것도 없으면 레거시 Supabase 프로젝트로 붙고 DB는 없다', () => {
    const e = parseEnv({});
    expect(e.databaseUrl).toBeNull();
    expect(e.supabaseUrl).toMatch(/^https:\/\/.*supabase\.co$/);
    expect(e.supabaseJwtSecret).toBeNull();
    expect(e.registry.TRIP).toBe('LEGACY');
  });

  it('SUPABASE_URL 뒤의 슬래시는 떼어 issuer 비교가 어긋나지 않게 한다', () => {
    expect(parseEnv({ SUPABASE_URL: 'https://x.supabase.co/' }).supabaseUrl).toBe('https://x.supabase.co');
    expect(parseEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://y.supabase.co' }).supabaseUrl).toBe('https://y.supabase.co');
  });

  it('DATABASE_URL과 레지스트리를 함께 읽는다', () => {
    const e = parseEnv({ DATABASE_URL: 'postgres://u:p@h/db', TC_MIGRATION_TRIP: 'NEW_BACKEND' });
    expect(e.databaseUrl).toBe('postgres://u:p@h/db');
    expect(e.registry.TRIP).toBe('NEW_BACKEND');
  });
});

describe('parseEnv — 자체 Auth(§57·§58)', () => {
  it('AUTH_SECRET이 없으면 새 Auth는 꺼진 채로 둔다 — 약한 기본값을 몰래 쓰지 않는다', () => {
    const e = parseEnv({ DATABASE_URL: 'postgres://x' });
    expect(e.authSecret).toBeNull();
    expect(e.newAuthEnabled).toBe(false);
  });

  it('짧은 AUTH_SECRET은 거부하고 이유를 남긴다', () => {
    const warnings: string[] = [];
    const e = parseEnv({ DATABASE_URL: 'postgres://x', AUTH_SECRET: 'too-short' }, (m) => warnings.push(m));
    expect(e.authSecret).toBeNull();
    expect(e.newAuthEnabled).toBe(false);
    expect(warnings.join(' ')).toMatch(/AUTH_SECRET/);
  });

  it('충분한 비밀과 DATABASE_URL이 있어야 새 Auth가 켜진다', () => {
    const secret = 'a'.repeat(32);
    expect(parseEnv({ AUTH_SECRET: secret }).newAuthEnabled).toBe(false);   // DB가 없으면 못 쓴다
    const e = parseEnv({ DATABASE_URL: 'postgres://x', AUTH_SECRET: secret, API_BASE_URL: 'https://api.example.com/' });
    expect(e.newAuthEnabled).toBe(true);
    expect(e.authSecret).toBe(secret);
    expect(e.apiBaseUrl).toBe('https://api.example.com');
  });

  it('SMTP는 host와 from이 있어야 쓴다 — 반쯤 설정된 채로 메일을 삼키지 않는다', () => {
    expect(parseEnv({}).smtp).toBeNull();
    expect(parseEnv({ SMTP_HOST: 'smtp.example.com' }).smtp).toBeNull();
    const e = parseEnv({ SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'Trip Canvas <no-reply@example.com>', SMTP_USER: 'u', SMTP_PASSWORD: 'p' });
    expect(e.smtp).toMatchObject({ host: 'smtp.example.com', port: 587, from: 'Trip Canvas <no-reply@example.com>', user: 'u' });
  });

  it('신뢰 출처(§72)는 쉼표로 나누고 빈 값은 버린다', () => {
    expect(parseEnv({ TRUSTED_ORIGINS: 'https://a.com, https://b.com ,' }).trustedOrigins).toEqual(['https://a.com', 'https://b.com']);
    // 설정이 없으면 이 앱의 알려진 웹 주소 — 배포할 때 뭘 설정하지 않아도 동작해야 한다
    expect(parseEnv({}).trustedOrigins).toContain('https://tripcanvas-ai.vercel.app');
  });
});
