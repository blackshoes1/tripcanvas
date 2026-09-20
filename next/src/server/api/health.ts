// health(§64·§65) — 구성요소별 상태를 한 번에. 리버스 프록시·Docker healthcheck·외부 감시(api/health-watch.js)가 본다.
//
//   HEALTHY      전부 정상
//   DEGRADED     기능은 살아 있는데 무언가 어긋났다 — 실시간 없음(폴백 있음) · 백업이 낡음 · 점검(읽기 전용) 모드
//   UNAVAILABLE  저장 경로가 죽었다(DB) — 이것만 503이다
//
// 하위 호환: `ok`·`api`·`database` 필드는 그대로 둔다 — Docker HEALTHCHECK와 감시 함수가 읽는다.
// 비밀·연결 문자열·호스트는 절대 싣지 않는다. 상세는 고정 문구·시각·시간 수뿐이다.
export type OverallStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
export type ComponentStatus = 'ok' | 'degraded' | 'error' | 'unconfigured';
export interface HealthComponent { status: ComponentStatus; detail?: string }

export interface HealthReport {
  ok: boolean;
  status: OverallStatus;
  api: 'ok';
  database: 'ok' | 'unconfigured' | 'error';
  readOnly: boolean;
  /** 이미지 빌드 때 박힌 커밋 SHA(`TC_REVISION`). 없으면 'unknown' — 배포 스크립트가 이 값으로 새 코드가 도는지 확인한다 */
  revision: string;
  components: {
    api: HealthComponent;
    database: HealthComponent;
    realtime: HealthComponent;
    backup: HealthComponent;
  };
  checkedAt: string;
}

export interface HealthDeps {
  databaseConfigured: boolean;
  checkDatabase: () => Promise<void>;
  /** 실시간 사이드카 내부 헬스. null이면 검사하지 않는다(unconfigured) */
  checkRealtime?: (() => Promise<{ listening: boolean }>) | null;
  /** 마지막 **성공한** 백업의 완료 시각. null = 기록 없음. 주입하지 않으면 검사하지 않는다 */
  lastBackupAt?: (() => Promise<Date | null>) | null;
  /** 백업이 이 시간 안에 있어야 정상(기본 26시간 — 하루 한 번 + 여유) */
  backupMaxAgeHours?: number;
  readOnly?: boolean;
  /** `TC_REVISION` — 빈 값이면 'unknown'으로 답한다 */
  revision?: string;
  now?: () => Date;
}

const DEFAULT_BACKUP_MAX_AGE_HOURS = 26;

export async function healthReport(deps: HealthDeps): Promise<HealthReport> {
  const now = (deps.now ?? (() => new Date()))();
  const checkedAt = now.toISOString();
  const readOnly = !!deps.readOnly;

  let database: HealthComponent;
  if (!deps.databaseConfigured) {
    database = { status: 'unconfigured' };
  } else {
    try { await deps.checkDatabase(); database = { status: 'ok' }; }
    catch { database = { status: 'error' }; }   // 이유는 로그로만 — 응답에 연결 문자열·계정이 섞여 나가지 않게
  }

  let realtime: HealthComponent;
  if (!deps.checkRealtime) {
    realtime = { status: 'unconfigured' };
  } else {
    try {
      const r = await deps.checkRealtime();
      // 끊긴 LISTEN은 조용하다 — 프로세스가 살아 있어도 알림이 영영 안 온다. 그래서 '살았나'가 아니라 '듣고 있나'를 본다
      realtime = r.listening ? { status: 'ok' } : { status: 'error', detail: 'LISTEN이 붙어 있지 않다 — 앱은 새로고침으로 갱신된다' };
    } catch { realtime = { status: 'error', detail: '사이드카에 닿지 못했다 — 앱은 새로고침으로 갱신된다' }; }
  }

  let backup: HealthComponent;
  if (!deps.lastBackupAt) {
    backup = { status: 'unconfigured' };
  } else {
    const maxAge = deps.backupMaxAgeHours ?? DEFAULT_BACKUP_MAX_AGE_HOURS;
    try {
      const last = await deps.lastBackupAt();
      if (!last) backup = { status: 'error', detail: '성공한 백업 기록이 없다' };
      else {
        const ageHours = Math.max(0, (now.getTime() - last.getTime()) / 3_600_000);
        const rounded = Math.round(ageHours * 10) / 10;
        backup = ageHours <= maxAge
          ? { status: 'ok', detail: `마지막 성공 ${last.toISOString()} (${rounded}시간 전)` }
          : { status: 'degraded', detail: `마지막 성공 ${last.toISOString()} — ${rounded}시간 전, 허용 ${maxAge}시간` };
      }
    } catch { backup = { status: 'error', detail: '백업 기록을 읽지 못했다' }; }
  }

  const components = { api: { status: 'ok' as const }, database, realtime, backup };
  const status: OverallStatus = database.status === 'error'
    ? 'UNAVAILABLE'
    : (readOnly || [realtime, backup].some((c) => c.status === 'error' || c.status === 'degraded'))
      ? 'DEGRADED'
      : 'HEALTHY';
  return {
    ok: status !== 'UNAVAILABLE',
    status,
    api: 'ok',
    database: database.status === 'ok' ? 'ok' : database.status === 'unconfigured' ? 'unconfigured' : 'error',
    readOnly,
    revision: deps.revision?.trim() || 'unknown',
    components,
    checkedAt
  };
}

/** 사이드카의 GET /health를 읽는다 — `listener`가 LISTENING일 때만 듣고 있는 것이다 */
export async function probeRealtimeHealth(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 3000): Promise<{ listening: boolean }> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  const body = (await res.json().catch(() => null)) as { listener?: string } | null;
  return { listening: res.ok && body?.listener === 'LISTENING' };
}
