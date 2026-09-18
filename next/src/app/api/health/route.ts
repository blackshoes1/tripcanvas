// GET /api/health — API · PostgreSQL · 실시간(LISTEN) · 백업 최신성 · 점검 모드. 리버스 프록시·Docker healthcheck·외부 감시가 본다.
// 503은 DB가 죽었을 때뿐이다. 실시간·백업은 DEGRADED(200)로 알린다 — 폴백이 있는 것으로 새벽에 깨우지 않는다.
import { getEnv } from '@/server/config/env';
import { healthReport, probeRealtimeHealth } from '@/server/api/health';
import { checkDatabase, lastSuccessfulBackupAt } from '@/server/infrastructure/database/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const env = getEnv();
  const report = await healthReport({
    databaseConfigured: !!env.databaseUrl,
    checkDatabase,
    checkRealtime: env.realtimeHealthUrl ? () => probeRealtimeHealth(env.realtimeHealthUrl!) : null,
    lastBackupAt: env.databaseUrl && env.backupMaxAgeHours ? lastSuccessfulBackupAt : null,
    backupMaxAgeHours: env.backupMaxAgeHours ?? undefined,
    readOnly: env.readOnly,
    revision: process.env.TC_REVISION   // 이미지 빌드 때 박힌 커밋 SHA — 배포 스크립트가 이 값으로 '새 코드가 도는지'를 확인한다
  });
  return Response.json(report, { status: report.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
