// 여행 버전 이력 라우트 — HTTP만: 인증 → 검증 → SnapshotService → 응답/오류 계약.
import { z } from 'zod';

import { CONTRACT_SCHEMA_VERSION } from '@/features/trip-state/domain/contract';
import type { SnapshotService } from '../application/trip/snapshotService';
import { authenticate, bearerToken } from '../auth/authenticate';
import type { RequestContext, TokenVerifier } from '../auth/types';
import { ApiError, errorResponse, JSON_HEADERS } from './errors';

export interface SnapshotRouteDeps {
  verifier: TokenVerifier;
  serviceFor(ctx: RequestContext, token: string): Promise<SnapshotService>;
}

const CreateBody = z.object({ name: z.string().max(500).nullable().optional() });

function ok(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ schemaVersion: CONTRACT_SCHEMA_VERSION, ...body }), { status, headers: JSON_HEADERS });
}

export function createSnapshotRoutes(deps: SnapshotRouteDeps) {
  async function withService<T>(request: Request, fn: (ctx: RequestContext, service: SnapshotService) => Promise<T>): Promise<T | Response> {
    try {
      const ctx = await authenticate(request, deps.verifier);
      return await fn(ctx, await deps.serviceFor(ctx, bearerToken(request) ?? ''));
    } catch (e) {
      if (!(e instanceof ApiError)) console.error('[tripcanvas-api] snapshot route failed:', e instanceof Error ? e.message : e);
      return errorResponse(e);
    }
  }

  return {
    /** GET /api/v1/trips/:tripId/snapshots — 내 버전 이력(최근 15개) */
    list: (request: Request, tripId: string) => withService(request, async (ctx, service) =>
      ok({ snapshots: await service.list(ctx, tripId) })),

    /** POST /api/v1/trips/:tripId/snapshots — 지금 저장된 문서를 떠 둔다 { name? } */
    create: (request: Request, tripId: string) => withService(request, async (ctx, service) => {
      let raw: unknown = {};
      try { raw = await request.json(); } catch { /* 본문 없이 불러도 된다 */ }
      const parsed = CreateBody.safeParse(raw ?? {});
      if (!parsed.success) throw new ApiError('VALIDATION_ERROR', { message: 'name은 문자열입니다.' });
      return ok({ snapshot: await service.create(ctx, tripId, parsed.data.name ?? null) }, 201);
    }),

    /** GET /api/v1/trips/:tripId/snapshots/:snapshotId — 그 버전의 문서 */
    load: (request: Request, tripId: string, snapshotId: string) => withService(request, async (ctx, service) => {
      if (!/^\d+$/.test(snapshotId)) throw new ApiError('VALIDATION_ERROR', { message: 'snapshotId가 올바르지 않습니다.' });
      const snapshot = await service.load(ctx, tripId, Number(snapshotId));
      return ok({ snapshot });
    })
  };
}
