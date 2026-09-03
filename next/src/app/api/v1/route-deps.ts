// /api/v1 라우트가 공유하는 실제 의존성. 테스트는 createHandlers/createTripRoutes에 가짜를 넣어 이 파일을 거치지 않는다.
//
// Strangler 분기(§35): 이관 레지스트리 TRIP 값에 따라
//   LEGACY       Supabase 그대로(오늘의 동작). 토큰만 서버가 직접 검증한다(Phase A) — 실패하면 예전처럼 getUser로 확인
//   DUAL_READ    새 PostgreSQL → 없으면 Supabase. 쓰기는 그 행이 온 곳으로
//   NEW_BACKEND  새 PostgreSQL만
// 기존 핸들러(Today·travel-state…)의 Trip 읽기/쓰기(listTrips/getTrip/saveTrip)도 같은 TripService를 지난다.
// 나머지(제안 거절·가격·알림·기기·기록)는 아직 Supabase다 — Phase 4.
import { createHandlers, type Gateway, type TripRow } from '@/features/trip-state/services/handlers';
import { supabaseGatewayFor } from '@/features/trip-state/services/supabaseGateway';
import type { TripDoc } from '@/features/trip-state/domain/todayView';
import { ApiError } from '@/server/api/errors';
import { createTripRoutes } from '@/server/api/tripRoutes';
import { TripAuthorizationService } from '@/server/application/authorization/tripAuthorization';
import { TripService } from '@/server/application/trip/tripService';
import { remoteSupabaseUser } from '@/server/auth/remoteSupabaseUser';
import { createSupabaseVerifier } from '@/server/auth/supabaseJwt';
import type { RequestContext } from '@/server/auth/types';
import { withRemoteFallback } from '@/server/auth/withRemoteFallback';
import { getEnv } from '@/server/config/env';
import { getDb } from '@/server/infrastructure/database/client';
import { PgMembershipRepository } from '@/server/infrastructure/database/pgMembershipRepository';
import { PgTripRepository } from '@/server/infrastructure/database/pgTripRepository';
import { PgUserRepository } from '@/server/infrastructure/database/pgUserRepository';
import {
  LegacyMembershipRepository, LegacySupabaseSession, LegacyTripRepository
} from '@/server/infrastructure/supabase/legacyTripRepository';
import { DualReadMembershipRepository, DualReadTripRepository } from '@/server/repositories/dualRead';
import type { MembershipRepository, TripRepository, TripView } from '@/server/repositories/types';

const env = getEnv();
export const verifier = withRemoteFallback(
  createSupabaseVerifier({ supabaseUrl: env.supabaseUrl, jwtSecret: env.supabaseJwtSecret }),
  remoteSupabaseUser(env.supabaseUrl)
);

function legacyRepos(ctx: RequestContext, token: string): { trips: TripRepository; members: MembershipRepository } {
  const session = new LegacySupabaseSession(token, env.supabaseUrl, ctx.userId);
  return { trips: new LegacyTripRepository(session), members: new LegacyMembershipRepository(session) };
}

/** 요청 하나가 쓸 TripService — 레지스트리에 따라 저장소를 고른다. 새 DB를 쓰는 경로면 users 행을 보장한다 */
export async function tripServiceFor(ctx: RequestContext, token: string): Promise<TripService> {
  const state = env.registry.TRIP;
  const db = state === 'LEGACY' ? null : getDb();
  let repos: { trips: TripRepository; members: MembershipRepository };
  if (!db) {
    repos = legacyRepos(ctx, token);
  } else {
    await new PgUserRepository(db).ensure({ id: ctx.userId, email: ctx.email });
    const pg = { trips: new PgTripRepository(db), members: new PgMembershipRepository(db) };
    if (state === 'DUAL_READ') {
      const legacy = legacyRepos(ctx, token);
      repos = { trips: new DualReadTripRepository(pg.trips, legacy.trips), members: new DualReadMembershipRepository(pg.members, legacy.members) };
    } else {
      repos = pg;
    }
  }
  return new TripService({ ...repos, authz: new TripAuthorizationService(repos.members) });
}

export const tripRoutes = createTripRoutes({ verifier, serviceFor: tripServiceFor });

function toRow(v: TripView): TripRow {
  return {
    client_id: v.record.clientId, data: v.record.data as TripDoc, revision: v.record.revision,
    updated_at: v.record.updatedAt, deleted_at: v.record.deletedAt, role: v.role, member_count: v.memberCount
  };
}

/** 기존 핸들러의 Gateway — Trip 읽기/쓰기만 TripService로, 나머지는 Supabase 그대로 */
async function gatewayFor(token: string): Promise<Gateway | null> {
  const ctx = await verifier.verify(token);
  if (!ctx) return null;
  const legacy = await supabaseGatewayFor(token, ctx.userId);
  if (!legacy || env.registry.TRIP === 'LEGACY') return legacy;
  const service = await tripServiceFor(ctx, token);
  return {
    ...legacy,
    async listTrips() { return (await service.list(ctx)).map(toRow); },
    async getTrip(tripId) {
      try { return toRow(await service.get(ctx, tripId)); } catch (e) { if (e instanceof ApiError && e.code === 'NOT_FOUND') return null; throw e; }
    },
    async saveTrip(tripId, doc, expectedRevision) {
      try {
        const view = await service.update(ctx, tripId, doc, expectedRevision);
        return { applied: true, conflict: false, revision: view.record.revision, data: view.record.data as TripDoc };
      } catch (e) {
        if (e instanceof ApiError && e.code === 'STALE_VERSION') return { applied: false, conflict: true, revision: Number(e.details?.revision) || expectedRevision, data: null };
        if (e instanceof ApiError && e.code === 'FORBIDDEN') return { applied: false, conflict: false, forbidden: true, revision: expectedRevision, data: null };
        throw e;
      }
    }
  };
}

export const handlers = createHandlers({ gatewayFor });
