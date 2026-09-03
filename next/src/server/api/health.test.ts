// GET /api/health(§64) — API 자체와 PostgreSQL(설정돼 있을 때)의 상태. 비밀·연결 문자열은 절대 싣지 않는다.
import { describe, expect, it } from 'vitest';

import { healthReport } from './health';

describe('healthReport', () => {
  it('DB가 설정되지 않은 배포(오늘의 Vercel)는 unconfigured로 정직하게 답하고 ok다', async () => {
    const r = await healthReport({ databaseConfigured: false, checkDatabase: async () => { throw new Error('should not be called'); } });
    expect(r.ok).toBe(true);
    expect(r.database).toBe('unconfigured');
  });

  it('DB 조회가 되면 ok', async () => {
    const r = await healthReport({ databaseConfigured: true, checkDatabase: async () => undefined });
    expect(r).toMatchObject({ ok: true, api: 'ok', database: 'ok' });
  });

  it('DB 조회가 실패하면 ok:false, error — 내부 메시지는 밖으로 내지 않는다', async () => {
    const r = await healthReport({ databaseConfigured: true, checkDatabase: async () => { throw new Error('password authentication failed for user "tc"'); } });
    expect(r.ok).toBe(false);
    expect(r.database).toBe('error');
    expect(JSON.stringify(r)).not.toMatch(/password/);
  });
});
