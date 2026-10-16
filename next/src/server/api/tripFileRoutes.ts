import { z } from 'zod';
import { AUDIO_LIMIT, DOCUMENT_LIMIT, type TripFilesService } from '../application/trip/tripFiles';
import { authenticate, bearerToken } from '../auth/authenticate';
import type { RequestContext, TokenVerifier } from '../auth/types';
import { ApiError, errorResponse, JSON_HEADERS } from './errors';

const Input = z.object({ kind: z.enum(['AUDIO', 'DOCUMENT']), placeKey: z.string().max(600), name: z.string().min(1).max(240) });
const Edit = z.object({ title: z.string().trim().min(1).max(180).optional(), position: z.number().int().min(0).max(10000).optional(), move: z.enum(['UP', 'DOWN']).optional() })
  .strict().refine(value => Object.keys(value).length > 0);
let activeUploads = 0;
export async function readFileBytes(request: Request, limit: number): Promise<Buffer> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new ApiError('VALIDATION_ERROR', { message: '파일이 너무 커요.' });
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('VALIDATION_ERROR', { message: '파일을 골라 주세요.' });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ApiError('VALIDATION_ERROR', { message: '파일이 너무 커요.' }); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export function createTripFileRoutes(deps: {
  verifier: TokenVerifier; serviceFor(ctx: RequestContext, token: string): Promise<TripFilesService>;
}) {
  async function handle(request: Request, tripId: string, action: 'list' | 'upload' | 'get' | 'edit' | 'remove', id?: string) {
    try {
      const ctx = await authenticate(request, deps.verifier);
      const service = await deps.serviceFor(ctx, bearerToken(request) ?? '');
      // Reject unauthorized uploads before consuming their bytes.
      await service.resolve(ctx, tripId, ['upload', 'edit', 'remove'].includes(action));
      if (id && !z.uuid().safeParse(id).success) throw new ApiError('VALIDATION_ERROR');
      let result: unknown;
      if (action === 'list') result = await service.list(ctx, tripId);
      else if (action === 'upload') {
        const query = new URL(request.url).searchParams;
        const parsed = Input.safeParse({ kind: query.get('kind'), placeKey: query.get('placeKey') ?? '', name: query.get('name') });
        if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
        if (activeUploads >= 2) throw new ApiError('RATE_LIMITED', { message: '다른 파일을 저장 중이에요. 잠시 뒤 다시 시도해 주세요.' });
        activeUploads++;
        try {
          const bytes = await readFileBytes(request, parsed.data.kind === 'AUDIO' ? AUDIO_LIMIT : DOCUMENT_LIMIT);
          result = { file: await service.save(ctx, tripId, parsed.data, bytes) };
        } finally { activeUploads--; }
      } else if (action === 'get') {
        const file = await service.get(ctx, tripId, id!);
        return new Response(new Uint8Array(Buffer.from(file.contentBase64, 'base64')), { headers: {
          'content-type': file.mime, 'content-length': String(file.size), 'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'",
          'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.name)
        } });
      } else if (action === 'edit') {
        const bytes = await readFileBytes(request, 2048);
        let body: unknown;
        try { body = JSON.parse(bytes.toString('utf8')); } catch { throw new ApiError('VALIDATION_ERROR'); }
        const parsed = Edit.safeParse(body);
        if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
        await service.edit(ctx, tripId, id!, parsed.data); result = { ok: true };
      } else { await service.remove(ctx, tripId, id!); result = { ok: true }; }
      return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
    } catch (error) { return errorResponse(error); }
  }
  return {
    list: (r: Request, trip: string) => handle(r, trip, 'list'),
    upload: (r: Request, trip: string) => handle(r, trip, 'upload'),
    get: (r: Request, trip: string, id: string) => handle(r, trip, 'get', id),
    edit: (r: Request, trip: string, id: string) => handle(r, trip, 'edit', id),
    remove: (r: Request, trip: string, id: string) => handle(r, trip, 'remove', id)
  };
}
