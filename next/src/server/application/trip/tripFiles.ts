import { createHash } from 'node:crypto';
import { ApiError } from '../../api/errors';
import type { RequestContext } from '../../auth/types';
import type { TripService } from './tripService';

export const AUDIO_LIMIT = 25 * 1024 * 1024;
export const DOCUMENT_LIMIT = 10 * 1024 * 1024;
export const TRIP_FILE_LIMIT = 200 * 1024 * 1024;
export type FileKind = 'AUDIO' | 'DOCUMENT';
export interface TripFile {
  id: string; kind: FileKind; placeKey: string; name: string; title: string;
  mime: string; size: number; position: number; createdAt: string;
}
export interface FileInput extends TripFile { contentBase64: string; sha256: string }
export interface FilePatch { title?: string; position?: number; move?: 'UP' | 'DOWN' }
export interface TripFileRepository {
  list(tripId: string, userId: string): Promise<{ files: TripFile[]; canEdit: boolean }>;
  get(tripId: string, userId: string, id: string): Promise<FileInput>;
  save(tripId: string, userId: string, file: FileInput): Promise<TripFile>;
  edit(tripId: string, userId: string, id: string, patch: FilePatch): Promise<void>;
  remove(tripId: string, userId: string, id: string): Promise<void>;
}

/** Same identity rule as the existing local audio store; indices never identify a place. */
export function filePlaceKey(spot: Record<string, unknown>): string {
  for (const [field, provider] of [['placeId', 'google'], ['kakaoId', 'kakao']]) {
    const id = String(spot[field] ?? '').trim();
    if (id) return JSON.stringify([provider, id]);
  }
  const lat = spot.lat, lng = spot.lng;
  if ((typeof lat === 'number' || typeof lat === 'string') && String(lat).trim() &&
      (typeof lng === 'number' || typeof lng === 'string') && String(lng).trim() &&
      Number.isFinite(+lat) && Number.isFinite(+lng) && Math.abs(+lat) <= 90 && Math.abs(+lng) <= 180) {
    return JSON.stringify(['point', (+lat).toFixed(6), (+lng).toFixed(6)]);
  }
  const name = String(spot.name ?? '').trim().toLowerCase();
  return name ? JSON.stringify(['name', String(spot.city ?? '').trim().toLowerCase(), name]) : '';
}

/** Inspect signatures instead of trusting the browser MIME or a renamed executable. */
export function inspectFile(name: string, bytes: Buffer, kind: FileKind): string {
  const ext = name.split('.').pop()?.toLowerCase(), head = bytes.subarray(0, 16);
  const ascii = (start: number, end: number) => head.subarray(start, end).toString('ascii');
  const invalid = () => new ApiError('VALIDATION_ERROR', { message: '파일 형식을 확인해 주세요. 음성은 MP3·M4A·WAV·OGG·FLAC, 문서는 PDF·JPEG·PNG·WebP·TXT를 지원해요.' });
  if (!bytes.length || bytes.length > (kind === 'AUDIO' ? AUDIO_LIMIT : DOCUMENT_LIMIT)) {
    throw new ApiError('VALIDATION_ERROR', { message: kind === 'AUDIO' ? '음성은 파일당 25MB까지 공유할 수 있어요.' : '문서는 파일당 10MB까지 첨부할 수 있어요.' });
  }
  if (kind === 'AUDIO') {
    if (ext === 'mp3' && (ascii(0, 3) === 'ID3' || (head[0] === 255 && (head[1] & 224) === 224))) return 'audio/mpeg';
    if (ext === 'm4a' && ascii(4, 8) === 'ftyp') return 'audio/mp4';
    if (ext === 'wav' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
    if (['ogg', 'oga', 'opus'].includes(ext ?? '') && ascii(0, 4) === 'OggS') return 'audio/ogg';
    if (ext === 'flac' && ascii(0, 4) === 'fLaC') return 'audio/flac';
  } else {
    if (ext === 'pdf' && ascii(0, 5) === '%PDF-') return 'application/pdf';
    if (['jpg', 'jpeg'].includes(ext ?? '') && head[0] === 255 && head[1] === 216 && head[2] === 255) return 'image/jpeg';
    if (ext === 'png' && head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (ext === 'webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    if (ext === 'txt' && !bytes.includes(0)) {
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'text/plain'; } catch { /* invalid UTF-8 */ }
    }
  }
  throw invalid();
}

export class TripFilesService {
  constructor(private readonly trips: TripService, private readonly files: TripFileRepository) {}
  async resolve(ctx: RequestContext, clientId: string, write = false) {
    const view = await this.trips.get(ctx, clientId);
    if (write && view.role !== 'OWNER' && view.role !== 'EDITOR') throw new ApiError('FORBIDDEN');
    return view;
  }
  async list(ctx: RequestContext, clientId: string) {
    const view = await this.resolve(ctx, clientId);
    return this.files.list(view.record.id, ctx.userId);
  }
  async get(ctx: RequestContext, clientId: string, id: string) {
    const view = await this.resolve(ctx, clientId);
    return this.files.get(view.record.id, ctx.userId, id);
  }
  async save(ctx: RequestContext, clientId: string, input: { kind: FileKind; placeKey: string; name: string }, bytes: Buffer) {
    const view = await this.resolve(ctx, clientId, true);
    if (input.kind === 'AUDIO' && !input.placeKey) throw new ApiError('VALIDATION_ERROR', { message: '음성을 연결할 장소를 골라 주세요.' });
    if (input.placeKey) {
      const doc = view.record.data as { days?: { spots?: Record<string, unknown>[] }[] };
      if (!doc.days?.some(day => day.spots?.some(spot => filePlaceKey(spot) === input.placeKey))) {
        throw new ApiError('STALE_VERSION', { message: '연결할 장소가 바뀌었어요. 최신 일정에서 다시 골라 주세요.' });
      }
    }
    const name = input.name.normalize('NFC').replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().slice(0, 180);
    const mime = inspectFile(name, bytes, input.kind);
    return this.files.save(view.record.id, ctx.userId, {
      ...input, id: crypto.randomUUID(), name, title: name, mime, size: bytes.length,
      position: 0, createdAt: new Date().toISOString(),
      contentBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex')
    });
  }
  async edit(ctx: RequestContext, clientId: string, id: string, patch: FilePatch) {
    const view = await this.resolve(ctx, clientId, true);
    return this.files.edit(view.record.id, ctx.userId, id, patch);
  }
  async remove(ctx: RequestContext, clientId: string, id: string) {
    const view = await this.resolve(ctx, clientId, true);
    return this.files.remove(view.record.id, ctx.userId, id);
  }
}
