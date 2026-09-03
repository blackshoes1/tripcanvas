// health(§64·§65) — 하나로 시작한다. live/ready 분리는 필요해질 때.
export interface HealthReport {
  ok: boolean;
  api: 'ok';
  database: 'ok' | 'unconfigured' | 'error';
  checkedAt: string;
}

export async function healthReport(deps: {
  databaseConfigured: boolean;
  checkDatabase: () => Promise<void>;
  now?: () => Date;
}): Promise<HealthReport> {
  const checkedAt = (deps.now ?? (() => new Date()))().toISOString();
  if (!deps.databaseConfigured) return { ok: true, api: 'ok', database: 'unconfigured', checkedAt };
  try {
    await deps.checkDatabase();
    return { ok: true, api: 'ok', database: 'ok', checkedAt };
  } catch {
    // 이유는 로그로만 — 응답에 연결 문자열·계정이 섞여 나가지 않게
    return { ok: false, api: 'ok', database: 'error', checkedAt };
  }
}
