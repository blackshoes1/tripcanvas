import { z } from 'zod';
import { authenticate, bearerToken } from '../auth/authenticate';
import type { RequestContext, TokenVerifier } from '../auth/types';
import type { LiveActivityService } from '../live-activities/service';
import { ApiError, errorResponse, JSON_HEADERS } from './errors';
import { readJsonBody } from './jsonBody';

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Body = z.object({
  deviceId: ID, activityId: ID, tripId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  pushToken: z.string().regex(/^(?:[a-fA-F0-9]{2}){1,256}$/),
  environment: z.enum(['sandbox', 'production']), startedAtISO: z.string().datetime(),
  tokenRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
});

export function createLiveActivityRoutes(deps: {
  verifier: TokenVerifier;
  serviceFor(ctx: RequestContext, token: string): Promise<LiveActivityService>;
}) {
  async function handle(request: Request, registration: boolean): Promise<Response> {
    try {
      const ctx = await authenticate(request, deps.verifier);
      const service = await deps.serviceFor(ctx, bearerToken(request) ?? '');
      let result;
      if (registration) {
        const read = await readJsonBody(request, 4096);
        if (!read.ok) throw new ApiError('VALIDATION_ERROR');
        const parsed = Body.safeParse(read.value);
        if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
        result = await service.register(ctx, parsed.data);
      } else {
        const url = new URL(request.url);
        const deviceId = ID.safeParse(url.searchParams.get('deviceId'));
        const activityId = ID.safeParse(url.searchParams.get('activityId'));
        if (!deviceId.success || !activityId.success) throw new ApiError('VALIDATION_ERROR');
        result = await service.stop(ctx, deviceId.data, activityId.data);
      }
      return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
    } catch (error) { return errorResponse(error); }
  }
  return { register: (request: Request) => handle(request, true), stop: (request: Request) => handle(request, false) };
}
