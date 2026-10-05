import { authenticate } from '../auth/authenticate';
import type { RequestContext, TokenVerifier } from '../auth/types';
import type { JToneService } from '../application/account/jToneService';
import { ApiError, errorResponse, JSON_HEADERS } from './errors';
import { readJsonBody } from './jsonBody';

export function createJToneRoutes(deps: {
  verifier: TokenVerifier;
  serviceFor(ctx: RequestContext): Promise<JToneService>;
}) {
  async function preferences(request: Request): Promise<Response> {
    try {
      const ctx = await authenticate(request, deps.verifier);
      const service = await deps.serviceFor(ctx);
      let body;
      if (request.method === 'PUT') {
        const read = await readJsonBody(request, 1024);
        if (!read.ok) throw new ApiError('VALIDATION_ERROR');
        const input = read.value;
        if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).some((key) => key !== 'jTone')) throw new ApiError('VALIDATION_ERROR');
        body = await service.save((input as { jTone?: unknown }).jTone);
      } else body = await service.read();
      return new Response(JSON.stringify(body), { headers: JSON_HEADERS });
    } catch (e) { return errorResponse(e); }
  }
  return { preferences };
}
