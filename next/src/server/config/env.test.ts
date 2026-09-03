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
