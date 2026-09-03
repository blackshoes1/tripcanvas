// Trip API 라우트(§26·§31) — HTTP 관심사만: 인증 → 검증(zod) → TripService → 응답/오류 계약. 비즈니스 로직은 없다(§6).
import { z } from 'zod';

import type { TripDeleteResponse, TripDetailResponse, TripListResponse } from '@/features/trip-state/domain/contract';
import { CONTRACT_SCHEMA_VERSION } from '@/features/trip-state/domain/contract';
import { summarizeTrip, type TripDoc } from '@/features/trip-state/domain/todayView';
import type { TripService } from '../application/trip/tripService';
import { authenticate, bearerToken } from '../auth/authenticate';
import type { RequestContext, TokenVerifier } from '../auth/types';
import type { TripView } from '../repositories/types';
import { ApiError, errorResponse, JSON_HEADERS } from './errors';

export interface TripRouteDeps {
  verifier: TokenVerifier;
  /** 요청의 컨텍스트·토큰으로 그 요청이 쓸 서비스(레지스트리에 따라 새 DB 또는 레거시) */
  serviceFor(ctx: RequestContext, token: string): Promise<TripService>;
  now?: () => Date;
}

const TripBody = z.object({ trip: z.record(z.string(), z.unknown()) });
const TripWriteBody = TripBody.extend({ expectedRevision: z.number().int().min(1), force: z.boolean().optional() });

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try { raw = await request.json(); } catch { throw new ApiError('VALIDATION_ERROR', { message: '본문이 JSON이 아닙니다.' }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', { details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
  }
  return parsed.data;
}

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function createTripRoutes(deps: TripRouteDeps) {
  const now = deps.now ?? (() => new Date());
  const today = () => now().toISOString().slice(0, 10);

  function detail(view: TripView): TripDetailResponse {
    const r = view.record;
    return {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      trip: summarizeTrip({ client_id: r.clientId, data: r.data as TripDoc, revision: r.revision, updated_at: r.updatedAt, role: view.role, member_count: view.memberCount }, today()),
      document: r.data as Record<string, unknown>
    };
  }

  async function withService<T>(request: Request, fn: (ctx: RequestContext, service: TripService) => Promise<T>): Promise<T | Response> {
    try {
      const ctx = await authenticate(request, deps.verifier);
      return await fn(ctx, await deps.serviceFor(ctx, bearerToken(request) ?? ''));
    } catch (e) {
      if (!(e instanceof ApiError)) console.error('[tripcanvas-api] trip route failed:', e instanceof Error ? e.message : e);
      return errorResponse(e);
    }
  }

  return {
    /** GET /api/v1/trips */
    list: (request: Request) => withService(request, async (ctx, service) => {
      const views = await service.list(ctx);
      const body: TripListResponse = { schemaVersion: CONTRACT_SCHEMA_VERSION, trips: views.map((v) => detail(v).trip) };
      return ok(body);
    }),
    /** POST /api/v1/trips  { trip } */
    create: (request: Request) => withService(request, async (ctx, service) => {
      const body = await parseBody(request, TripBody);
      return ok(detail(await service.create(ctx, body.trip)), 201);
    }),
    /** GET /api/v1/trips/:id */
    get: (request: Request, tripId: string) => withService(request, async (ctx, service) => ok(detail(await service.get(ctx, tripId)))),
    /** PUT /api/v1/trips/:id  { trip, expectedRevision, force? } */
    update: (request: Request, tripId: string) => withService(request, async (ctx, service) => {
      const body = await parseBody(request, TripWriteBody);
      return ok(detail(await service.update(ctx, tripId, body.trip, body.expectedRevision, { force: body.force })));
    }),
    /** DELETE /api/v1/trips/:id?expectedRevision=N */
    remove: (request: Request, tripId: string) => withService(request, async (ctx, service) => {
      const raw = new URL(request.url).searchParams.get('expectedRevision');
      const expected = Number(raw);
      if (!raw || !Number.isInteger(expected) || expected < 1) throw new ApiError('VALIDATION_ERROR', { message: 'expectedRevision(마지막에 읽은 revision)이 필요합니다.' });
      const view = await service.delete(ctx, tripId, expected);
      const body: TripDeleteResponse = { schemaVersion: CONTRACT_SCHEMA_VERSION, deleted: true, revision: view.record.revision };
      return ok(body);
    })
  };
}
