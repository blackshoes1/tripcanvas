import { z } from 'zod';
import type { DailyMomentsService } from '../application/collaboration/dailyMomentsService';
import { authenticate, bearerToken } from '../auth/authenticate';
import type { RequestContext, TokenVerifier } from '../auth/types';
import { ApiError, errorResponse, JSON_HEADERS } from './errors';
import { readJsonBody } from './jsonBody';

const Body = z.object({ dayIndex: z.number().int().min(0).max(999), expectedRevision: z.number().int().positive(),
  spotKey: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict();

export function createDailyMomentsRoutes(deps: {
  verifier: TokenVerifier; serviceFor(ctx: RequestContext, token: string): Promise<DailyMomentsService>;
}) {
  async function handle(request: Request, tripId: string, write: boolean): Promise<Response> {
    try {
      const ctx = await authenticate(request, deps.verifier);
      const service = await deps.serviceFor(ctx, bearerToken(request) ?? '');
      let result;
      if (write) {
        const read = await readJsonBody(request, 2048), body = read.ok ? Body.safeParse(read.value) : null;
        if (!body?.success) throw new ApiError('VALIDATION_ERROR');
        result = await service.save(ctx, tripId, body.data.dayIndex, body.data.expectedRevision, body.data.spotKey);
      } else {
        const raw = new URL(request.url).searchParams.get('dayIndex');
        if (raw === null || !/^\d{1,3}$/.test(raw)) throw new ApiError('VALIDATION_ERROR');
        result = await service.get(ctx, tripId, Number(raw));
      }
      return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
    } catch (error) { return errorResponse(error); }
  }
  return { get: (request: Request, tripId: string) => handle(request, tripId, false), put: (request: Request, tripId: string) => handle(request, tripId, true) };
}
