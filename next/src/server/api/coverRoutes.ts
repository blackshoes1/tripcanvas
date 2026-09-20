import { z } from 'zod';

import type { CoverService } from '../application/trip/coverService';
import { authenticate, bearerToken } from '../auth/authenticate';
import type { RequestContext, TokenVerifier } from '../auth/types';
import { ApiError, errorResponse, JSON_HEADERS } from './errors';

const Body = z.object({ expectedRevision: z.number().int().min(0).max(2147483646), imageBase64: z.string().max(333336).nullable() });
const MAX_BODY = 340000;

/** Content-Lengthのないチャンク送信にも上限を適用する。 */
async function readBody(request: Request): Promise<z.infer<typeof Body>> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('VALIDATION_ERROR');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new ApiError('VALIDATION_ERROR', { message: '사진이 너무 큽니다.' }); }
      chunks.push(value);
    }
    const parsed = Body.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('VALIDATION_ERROR');
  } finally { reader.releaseLock(); }
}

export function createCoverRoutes(deps: {
  verifier: TokenVerifier;
  serviceFor(ctx: RequestContext, token: string): Promise<CoverService>;
}) {
  async function handle(request: Request, tripId: string, write: boolean): Promise<Response> {
    try {
      const ctx = await authenticate(request, deps.verifier);
      const service = await deps.serviceFor(ctx, bearerToken(request) ?? '');
      const body = write ? await readBody(request) : null;
      const cover = body ? await service.save(ctx, tripId, body.expectedRevision, body.imageBase64) : await service.get(ctx, tripId);
      return new Response(JSON.stringify(cover), { headers: JSON_HEADERS });
    } catch (error) { return errorResponse(error); }
  }
  return {
    get: (request: Request, tripId: string) => handle(request, tripId, false),
    put: (request: Request, tripId: string) => handle(request, tripId, true)
  };
}
