import sharp from 'sharp';

import { ApiError } from '../../api/errors';
import type { RequestContext } from '../../auth/types';
import type { TripService } from './tripService';

export interface TripCover { revision: number; imageBase64: string | null }
export interface CoverRepository {
  get(tripId: string): Promise<TripCover>;
  save(tripId: string, expectedRevision: number, imageBase64: string | null): Promise<TripCover | null>;
}

export class CoverService {
  constructor(private readonly trips: TripService, private readonly covers: CoverRepository) {}

  async get(ctx: RequestContext, clientId: string): Promise<TripCover> {
    const view = await this.trips.get(ctx, clientId);
    return this.covers.get(view.record.id);
  }

  async save(ctx: RequestContext, clientId: string, expected: number, image: string | null): Promise<TripCover> {
    const view = await this.trips.get(ctx, clientId);
    if (view.role !== 'OWNER' && view.role !== 'EDITOR') throw new ApiError('FORBIDDEN');
    const jpeg = image === null ? null : await normalizeCover(image);
    const saved = await this.covers.save(view.record.id, expected, jpeg);
    if (!saved) throw new ApiError('STALE_VERSION', { message: '다른 기기에서 표지가 바뀌었어요. 최신 표지를 확인한 뒤 다시 저장해 주세요.' });
    return saved;
  }
}

/** 클라이언트의 확장자·MIME을 믿지 않고 재인코딩한다. 원본 EXIF/GPS는 저장하지 않는다. */
export async function normalizeCover(base64: string): Promise<string> {
  const invalid = () => new ApiError('VALIDATION_ERROR', { message: '250KB 이하의 JPEG 사진을 선택해 주세요.' });
  if (!base64.length || base64.length > 333336 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw invalid();
  const input = Buffer.from(base64, 'base64');
  if (input.length > 250000 || input[0] !== 0xff || input[1] !== 0xd8) throw invalid();
  try {
    const output = await sharp(input, { limitInputPixels: 16000000, failOn: 'warning' })
      .rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 }).toBuffer();
    if (output.length > 250000) throw invalid();
    return output.toString('base64');
  } catch { throw invalid(); }
}
