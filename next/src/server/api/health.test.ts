// GET /api/health(§64) — 구성요소별 상태. **저장 경로가 죽었을 때만 UNAVAILABLE(503)** 이고,
// 실시간·백업·점검 모드는 DEGRADED(200)다. 비밀·연결 문자열은 절대 싣지 않는다.
import { describe, expect, it } from 'vitest';

import { healthReport, probeRealtimeHealth } from './health';

const ok = async () => undefined;
const at = (iso: string) => () => new Date(iso);

describe('healthReport', () => {
  it('DB가 설정되지 않은 배포는 unconfigured로 정직하게 답하고 ok다', async () => {
    const r = await healthReport({ databaseConfigured: false, checkDatabase: async () => { throw new Error('should not be called'); } });
    expect(r.ok).toBe(true);
    expect(r.database).toBe('unconfigured');
    expect(r.status).toBe('HEALTHY');
  });

  it('DB 조회가 되면 ok — 하위 호환 필드가 그대로 있다', async () => {
    const r = await healthReport({ databaseConfigured: true, checkDatabase: ok });
    expect(r).toMatchObject({ ok: true, api: 'ok', database: 'ok', status: 'HEALTHY', readOnly: false });
    expect(r.components.realtime.status).toBe('unconfigured');
    expect(r.components.backup.status).toBe('unconfigured');
  });

  it('revision은 빌드 때 박힌 커밋이고, 없으면 unknown이라고 말한다 — 배포 스크립트가 새 코드가 도는지 이걸로 본다', async () => {
    const built = await healthReport({ databaseConfigured: false, checkDatabase: ok, revision: '72d882f0000000000000000000000000deadbeef' });
    expect(built.revision).toBe('72d882f0000000000000000000000000deadbeef');
    const unknown = await healthReport({ databaseConfigured: false, checkDatabase: ok });
    expect(unknown.revision).toBe('unknown');
    const blank = await healthReport({ databaseConfigured: false, checkDatabase: ok, revision: '  ' });
    expect(blank.revision).toBe('unknown');
  });

  it('DB 조회가 실패하면 UNAVAILABLE — 내부 메시지는 밖으로 내지 않는다', async () => {
    const r = await healthReport({ databaseConfigured: true, checkDatabase: async () => { throw new Error('password authentication failed for user "tc"'); } });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.database).toBe('error');
    expect(JSON.stringify(r)).not.toMatch(/password/);
  });

  it('실시간이 듣고 있지 않으면 DEGRADED — 폴백이 있어 장애가 아니다', async () => {
    const r = await healthReport({ databaseConfigured: true, checkDatabase: ok, checkRealtime: async () => ({ listening: false }) });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('DEGRADED');
    expect(r.components.realtime.status).toBe('error');
    const listening = await healthReport({ databaseConfigured: true, checkDatabase: ok, checkRealtime: async () => ({ listening: true }) });
    expect(listening.status).toBe('HEALTHY');
    const unreachable = await healthReport({ databaseConfigured: true, checkDatabase: ok, checkRealtime: async () => { throw new Error('ECONNREFUSED 10.0.0.5:3001'); } });
    expect(unreachable.status).toBe('DEGRADED');
    expect(JSON.stringify(unreachable)).not.toMatch(/10\.0\.0\.5/);
  });

  it('백업: 26시간 안이면 ok, 넘으면 degraded, 기록이 없으면 error — 어느 쪽도 503은 아니다', async () => {
    const now = at('2026-09-17T12:00:00Z');
    const fresh = await healthReport({ databaseConfigured: true, checkDatabase: ok, now, lastBackupAt: async () => new Date('2026-09-17T02:00:00Z') });
    expect(fresh.status).toBe('HEALTHY');
    expect(fresh.components.backup).toMatchObject({ status: 'ok' });
    expect(fresh.components.backup.detail).toContain('10시간 전');

    const stale = await healthReport({ databaseConfigured: true, checkDatabase: ok, now, lastBackupAt: async () => new Date('2026-09-15T02:00:00Z') });
    expect(stale.status).toBe('DEGRADED');
    expect(stale.ok).toBe(true);
    expect(stale.components.backup.status).toBe('degraded');

    const none = await healthReport({ databaseConfigured: true, checkDatabase: ok, now, lastBackupAt: async () => null });
    expect(none.status).toBe('DEGRADED');
    expect(none.components.backup.status).toBe('error');

    const custom = await healthReport({ databaseConfigured: true, checkDatabase: ok, now, backupMaxAgeHours: 4, lastBackupAt: async () => new Date('2026-09-17T02:00:00Z') });
    expect(custom.components.backup.status).toBe('degraded');
  });

  // 배포 순서를 틀리면(새 api가 먼저, migrate가 나중) ops_backup_runs가 아직 없다.
  // 그때 조회가 던지는데, 그것이 503이 되면 저장이 멀쩡한데도 외부 감시가 장애를 울린다.
  it('백업 기록 조회가 실패해도 error일 뿐 503이 아니다 — 표가 아직 없는 배포 순간이 있다', async () => {
    const r = await healthReport({
      databaseConfigured: true,
      checkDatabase: ok,
      lastBackupAt: async () => { throw new Error('relation "ops_backup_runs" does not exist'); }
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('DEGRADED');
    expect(r.database).toBe('ok');
    expect(r.components.backup.status).toBe('error');
    // 내부 메시지는 밖으로 내지 않는다
    expect(JSON.stringify(r)).not.toContain('relation');
  });

  it('점검(읽기 전용) 모드는 DEGRADED로 보이되 ok다 — 읽기는 살아 있다', async () => {
    const r = await healthReport({ databaseConfigured: true, checkDatabase: ok, readOnly: true });
    expect(r).toMatchObject({ ok: true, status: 'DEGRADED', readOnly: true });
  });

  it('DB가 죽었으면 다른 무엇이 정상이어도 UNAVAILABLE이다 — 큰 것부터 말한다', async () => {
    const r = await healthReport({
      databaseConfigured: true, checkDatabase: async () => { throw new Error('down'); },
      checkRealtime: async () => ({ listening: true }), lastBackupAt: async () => new Date()
    });
    expect(r.status).toBe('UNAVAILABLE');
  });
});

describe('probeRealtimeHealth', () => {
  const fetchLike = (status: number, body: unknown) => (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch;
  it('listener가 LISTENING일 때만 듣고 있다', async () => {
    expect(await probeRealtimeHealth('http://realtime:3001/health', fetchLike(200, { ok: true, listener: 'LISTENING' }))).toEqual({ listening: true });
    expect(await probeRealtimeHealth('http://realtime:3001/health', fetchLike(503, { ok: false, listener: 'RECONNECTING' }))).toEqual({ listening: false });
    expect(await probeRealtimeHealth('http://realtime:3001/health', fetchLike(200, 'not json'))).toEqual({ listening: false });
  });
});
