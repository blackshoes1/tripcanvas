// 실시간 사이드카 진입점. `npm run realtime` (빌드는 npm run realtime:build).
//
// 흐름:  trip_activity INSERT → 트리거 pg_notify(커밋 시점) → LISTEN → 허브 → 구독자에게 {type,tripId,id,kind,mine}
// 클라이언트는 그 신호로 무엇을 다시 읽을지 정하고 내용은 API로 가져온다(§41·§44·§45).
//
// ⚠️ 이 서버는 **새 PostgreSQL이 진실일 때만** 의미가 있다. 협업이 아직 Supabase(TC_MIGRATION_COLLAB=LEGACY)면
// 새 DB에는 활동 행이 쌓이지 않아 알릴 것이 없다 — 그때는 웹이 예전처럼 Supabase Realtime을 쓴다.
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

import { remoteSupabaseUser } from '../auth/remoteSupabaseUser';
import { createSupabaseVerifier } from '../auth/supabaseJwt';
import { withRemoteFallback } from '../auth/withRemoteFallback';
import { parseEnv } from '../config/env';
import * as schema from '../infrastructure/database/schema';
import { PgTripRepository } from '../infrastructure/database/pgTripRepository';
import { REALTIME_CHANNEL } from './events';
import { createRealtimeHub } from './hub';
import { createPgListener, pgClientFactory } from './pgListener';
import { createRealtimeServer } from './server';

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  if (!env.databaseUrl) {
    console.error('[tripcanvas-realtime] DATABASE_URL이 없다 — 실시간 서버는 새 PostgreSQL에서만 돈다');
    process.exitCode = 1;
    return;
  }
  const port = Number(process.env.REALTIME_PORT || 3001);
  const pool = new Pool({ connectionString: env.databaseUrl, max: 4 });
  const trips = new PgTripRepository(drizzle(pool, { schema }));

  const verifier = withRemoteFallback(
    createSupabaseVerifier({ supabaseUrl: env.supabaseUrl, jwtSecret: env.supabaseJwtSecret }),
    remoteSupabaseUser(env.supabaseUrl)
  );

  const hub = createRealtimeHub({
    verifier,
    // 구독 권한 = 여행을 볼 수 있는 권한. 소유자 또는 활성 멤버(§41) — API와 같은 규칙을 같은 Repository로 판정한다
    canRead: async (userId, tripId) => {
      const view = await trips.findVisible(userId, tripId);
      return !!view && !view.record.deletedAt;
    },
    authTimeoutMs: 10_000,
    heartbeatMs: 30_000
  });

  const listener = createPgListener({
    channel: REALTIME_CHANNEL,
    connect: () => pgClientFactory(env.databaseUrl!),
    onPayload: (payload) => server.dispatch(payload)
  });

  const server = createRealtimeServer({ hub, listener, port });
  await listener.start();
  await server.start();

  const shutdown = async (signal: string) => {
    console.log(`[tripcanvas-realtime] ${signal} — 정리하고 내려간다`);
    await listener.stop();
    await server.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
