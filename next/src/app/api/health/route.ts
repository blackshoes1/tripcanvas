// GET /api/health — API와 PostgreSQL(설정돼 있을 때) 상태. 리버스 프록시·Docker healthcheck가 본다.
import { getEnv } from '@/server/config/env';
import { healthReport } from '@/server/api/health';
import { checkDatabase } from '@/server/infrastructure/database/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await healthReport({ databaseConfigured: !!getEnv().databaseUrl, checkDatabase });
  return Response.json(report, { status: report.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
