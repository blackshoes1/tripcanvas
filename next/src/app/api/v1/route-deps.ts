// /api/v1 라우트가 공유하는 실제 의존성. 테스트는 createHandlers/createTripRoutes에 가짜를 넣어 이 파일을 거치지 않는다.
//
// Strangler 분기(§35): 이관 레지스트리 TRIP 값에 따라
//   LEGACY       Supabase 그대로(오늘의 동작). 토큰만 서버가 직접 검증한다(Phase A) — 실패하면 예전처럼 getUser로 확인
//   DUAL_READ    새 PostgreSQL → 없으면 Supabase. 쓰기는 그 행이 온 곳으로
//   NEW_BACKEND  새 PostgreSQL만
// 기존 핸들러(Today·travel-state…)의 Trip 읽기/쓰기(listTrips/getTrip/saveTrip)도 같은 TripService를 지난다.
// 제안 거절·알림·기기·기록(ADAPTIVE)과 가격 관측(PRICING)도 각 레지스트리 값으로 조립한다(composeGateway).
import { createHandlers, type Gateway, type TripRow } from '@/features/trip-state/services/handlers';
import { supabaseGatewayFor } from '@/features/trip-state/services/supabaseGateway';
import type { TripDoc } from '@/features/trip-state/domain/todayView';
import { composeGateway } from '@/server/api/composeGateway';
import { ApiError } from '@/server/api/errors';
import { createCollabRoutes } from '@/server/api/collabRoutes';
import { createSnapshotRoutes } from '@/server/api/snapshotRoutes';
import { createTripRoutes } from '@/server/api/tripRoutes';
import { TripAuthorizationService } from '@/server/application/authorization/tripAuthorization';
import { CollabService } from '@/server/application/collaboration/collabService';
import type { CollabApi } from '@/server/application/collaboration/types';
import { SnapshotService } from '@/server/application/trip/snapshotService';
import { TripService } from '@/server/application/trip/tripService';
import { composeVerifiers } from '@/server/auth/compositeVerifier';
import { getNewAuth } from '@/server/auth/instance';
import { remoteSupabaseUser } from '@/server/auth/remoteSupabaseUser';
import { createSupabaseVerifier } from '@/server/auth/supabaseJwt';
import type { RequestContext } from '@/server/auth/types';
import { withRemoteFallback } from '@/server/auth/withRemoteFallback';
import { getEnv } from '@/server/config/env';
import { getDb } from '@/server/infrastructure/database/client';
import {
  PgDeviceRepository, PgMemoryRepository, PgNotificationLogRepository, PgSuggestionFeedbackRepository
} from '@/server/infrastructure/database/pgAdaptiveRepositories';
import { PgCollabRepository } from '@/server/infrastructure/database/pgCollabRepository';
import { PgMembershipRepository } from '@/server/infrastructure/database/pgMembershipRepository';
import { PgPriceObservationRepository } from '@/server/infrastructure/database/pgPriceObservationRepository';
import { PgTripRepository } from '@/server/infrastructure/database/pgTripRepository';
import { PgTripSnapshotRepository } from '@/server/infrastructure/database/pgTripSnapshotRepository';
import { PgUserRepository } from '@/server/infrastructure/database/pgUserRepository';
import { LegacySupabaseCollabService } from '@/server/infrastructure/supabase/legacyCollabService';
import {
  LegacyMembershipRepository, LegacySupabaseSession, LegacyTripRepository
} from '@/server/infrastructure/supabase/legacyTripRepository';
import { DualReadMembershipRepository, DualReadTripRepository } from '@/server/repositories/dualRead';
import type { MembershipRepository, TripRepository, TripView } from '@/server/repositories/types';

const env = getEnv();

// 전환기에는 Supabase 토큰과 자체 Auth 세션이 함께 산다(§14). Supabase를 먼저 보는 이유는 오늘의 트래픽이 전부 그쪽이라서다 —
// 자체 Auth가 꺼져 있으면(AUTH_SECRET·DATABASE_URL 없음) 예전과 완전히 같은 경로다.
const supabaseVerifier = withRemoteFallback(
  createSupabaseVerifier({ supabaseUrl: env.supabaseUrl, jwtSecret: env.supabaseJwtSecret }),
  remoteSupabaseUser(env.supabaseUrl)
);
const newAuth = getNewAuth();
export const verifier = newAuth ? composeVerifiers(supabaseVerifier, newAuth.verifier) : supabaseVerifier;

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

/**
 * 여행 버전 이력 — 새 DB에만 있다. 레거시(Supabase)의 trip_snapshots는 웹이 직접 읽고 쓰던 것이고,
 * 이 라우트는 이관 뒤(TRIP이 LEGACY가 아닐 때)를 위한 것이다. DB가 없으면 NOT_FOUND로 정직하게 답한다.
 */
export const snapshotRoutes = createSnapshotRoutes({
  verifier,
  serviceFor: async (ctx, token) => {
    const db = getDb();
    if (!db) throw new ApiError('NOT_FOUND', { message: '버전 이력은 아직 이 배포에서 쓸 수 없습니다.' });
    return new SnapshotService({ trips: await tripServiceFor(ctx, token), snapshots: new PgTripSnapshotRepository(db) });
  }
});

/**
 * 협업 API — COLLAB 레지스트리. LEGACY면 Supabase RPC 어댑터(판정은 RPC), 아니면 새 DB(CollabService).
 * 협업 테이블은 한 덩어리라 DUAL_READ를 따로 두지 않는다 — LEGACY가 아니면 새 DB다. 로그인 전(미리보기)은 항상 레거시 익명 클라이언트 또는 새 DB.
 */
export async function collabApiFor(ctx: RequestContext | null, token: string): Promise<CollabApi> {
  const db = env.registry.COLLAB === 'LEGACY' ? null : getDb();
  if (!db) return new LegacySupabaseCollabService(token, env.supabaseUrl);
  if (ctx) await new PgUserRepository(db).ensure({ id: ctx.userId, email: ctx.email });
  return new CollabService({ trips: new PgTripRepository(db), collab: new PgCollabRepository(db) });
}

export const collabRoutes = createCollabRoutes({ verifier, apiFor: collabApiFor });

function toRow(v: TripView): TripRow {
  return {
    client_id: v.record.clientId, data: v.record.data as TripDoc, revision: v.record.revision,
    updated_at: v.record.updatedAt, deleted_at: v.record.deletedAt, role: v.role, member_count: v.memberCount
  };
}

/** 기존 핸들러의 Gateway — 레지스트리가 LEGACY인 도메인은 Supabase 그대로, 아니면 새 저장소로 메서드를 바꿔 끼운다 */
async function gatewayFor(token: string): Promise<Gateway | null> {
  const ctx = await verifier.verify(token);
  if (!ctx) return null;
  const legacy = await supabaseGatewayFor(token, ctx.userId);
  if (!legacy) return null;
  const db = getDb();
  if (db && (env.registry.ADAPTIVE !== 'LEGACY' || env.registry.PRICING !== 'LEGACY')) {
    await new PgUserRepository(db).ensure({ id: ctx.userId, email: ctx.email });
  }
  const composed = composeGateway({
    registry: env.registry, userId: ctx.userId, legacy,
    adaptive: db ? {
      feedback: new PgSuggestionFeedbackRepository(db), notifications: new PgNotificationLogRepository(db),
      devices: new PgDeviceRepository(db), memories: new PgMemoryRepository(db)
    } : null,
    pricing: db ? new PgPriceObservationRepository(db) : null
  });
  if (env.registry.TRIP === 'LEGACY') return composed;
  const service = await tripServiceFor(ctx, token);
  return {
    ...composed,
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
