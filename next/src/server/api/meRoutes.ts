// GET /api/v1/me — 로그인 직후 한 번 부르는 가벼운 조회(my_trip_roles를 대신한다).
//
// 여행 목록(/trips)과 겹치지 않는다: 저쪽은 이름·기간·도시까지 주는 무거운 조회고, 이쪽은 **역할과 인원**만이다.
// 웹은 로그인·역할 갱신 때마다 이걸 부른다.
//
// 여기서 **어느 실시간을 쓸지도 알려 준다**(§45). 협업 데이터가 아직 Supabase에 있으면 새 사이드카에는
// 보낼 이벤트가 없다 — 클라이언트가 스스로 고르면 "실시간이라 표시되는데 아무것도 안 오는" 상태가 된다.
// 그 답을 아는 것은 레지스트리를 가진 서버뿐이다.
import { CONTRACT_SCHEMA_VERSION } from '@/features/trip-state/domain/contract';
import type { MigrationRegistry } from '../config/migrationRegistry';
import { authenticate } from '../auth/authenticate';
import type { RequestContext, TokenVerifier } from '../auth/types';
import type { TripView } from '../repositories/types';
import { ApiError, errorResponse, JSON_HEADERS } from './errors';

export type RealtimeProvider = 'TRIPCANVAS' | 'SUPABASE' | 'NONE';

export interface RealtimeChoice {
  provider: RealtimeProvider;
  url: string | null;
}

export interface MeTripRole {
  id: string;
  role: string;
  memberCount: number;
  owner: boolean;
  /** 내부 trips.id — Supabase 실시간 채널이 이 값을 쓴다. 그 경우에만 싣는다(전환기 한정) */
  supabaseTripId?: string;
}

export interface MeResponse {
  schemaVersion: number;
  user: { id: string; email: string | null };
  trips: MeTripRole[];
  realtime: RealtimeChoice;
}

/**
 * 자체 실시간은 **협업이 새 DB에 있고 주소가 설정됐을 때만** 쓴다.
 * 둘 중 하나라도 없으면 예전 경로(Supabase)거나 아예 없음이다 — 켜진 척하지 않는다.
 */
export function resolveRealtime(registry: MigrationRegistry, realtimeUrl: string | null): RealtimeChoice {
  if (registry.COLLAB === 'LEGACY') return { provider: 'SUPABASE', url: null };
  return realtimeUrl ? { provider: 'TRIPCANVAS', url: realtimeUrl } : { provider: 'NONE', url: null };
}

export interface MeRouteDeps {
  verifier: TokenVerifier;
  listTrips(ctx: RequestContext, token: string): Promise<TripView[]>;
  registry: MigrationRegistry;
  realtimeUrl: string | null;
}

export function createMeRoutes(deps: MeRouteDeps) {
  return {
    async me(request: Request): Promise<Response> {
      try {
        const ctx = await authenticate(request, deps.verifier);
        const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
        const realtime = resolveRealtime(deps.registry, deps.realtimeUrl);
        let views: TripView[];
        try {
          views = await deps.listTrips(ctx, token);
        } catch (e) {
          console.error('[tripcanvas-api] /me 조회 실패:', e instanceof Error ? e.message : e);
          throw new ApiError('INTERNAL_ERROR');
        }
        const body: MeResponse = {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          user: { id: ctx.userId, email: ctx.email },
          trips: views.filter((v) => !v.record.deletedAt).map((v) => ({
            id: v.record.clientId,
            role: v.role,
            memberCount: v.memberCount,
            owner: v.record.ownerId === ctx.userId,
            // 내부 식별자는 그것이 필요한 경로(Supabase 채널)일 때만 나간다
            ...(realtime.provider === 'SUPABASE' ? { supabaseTripId: v.record.id } : {})
          })),
          realtime
        };
        return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
      } catch (e) {
        return errorResponse(e);
      }
    }
  };
}
