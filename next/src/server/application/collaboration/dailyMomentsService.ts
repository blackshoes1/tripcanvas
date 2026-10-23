import { buildDailyMomentRows, dailyMomentOptions, type DailyMomentsResponse } from '@/features/trip-state/domain/dailyMoments';
import { ApiError } from '../../api/errors';
import type { RequestContext } from '../../auth/types';
import type { TripRepository, TripView } from '../../repositories/types';
import type { DailyMomentRepository } from '../../repositories/dailyMoments';

export class DailyMomentsService {
  constructor(private readonly trips: TripRepository, private readonly moments: DailyMomentRepository) {}

  private async visible(ctx: RequestContext, tripId: string): Promise<TripView> {
    const trip = await this.trips.findVisible(ctx.userId, tripId);
    if (!trip || trip.record.deletedAt) throw new ApiError('NOT_FOUND');
    return trip;
  }

  private async response(ctx: RequestContext, trip: TripView, dayIndex: number): Promise<DailyMomentsResponse> {
    const day = dailyMomentOptions(trip.record.data, dayIndex);
    if (!day) throw new ApiError('VALIDATION_ERROR', { message: '그날의 일정을 찾을 수 없어요.' });
    const rows = await this.moments.list(trip.record.id, day.dayKey);
    return { dayIndex, ...day, revision: trip.record.revision, moments: buildDailyMomentRows(rows, day.options, ctx.userId) };
  }

  async get(ctx: RequestContext, tripId: string, dayIndex: number): Promise<DailyMomentsResponse> {
    return this.response(ctx, await this.visible(ctx, tripId), dayIndex);
  }

  async save(ctx: RequestContext, tripId: string, dayIndex: number, expectedRevision: number, spotKey: string | null): Promise<DailyMomentsResponse> {
    const trip = await this.visible(ctx, tripId), day = dailyMomentOptions(trip.record.data, dayIndex);
    if (!day) throw new ApiError('VALIDATION_ERROR');
    if (trip.record.revision !== expectedRevision) throw new ApiError('STALE_VERSION', { details: { revision: trip.record.revision } });
    const selected = spotKey === null ? null : day.options.find(row => row.key === spotKey && row.selectable);
    if (spotKey !== null && !selected) throw new ApiError('VALIDATION_ERROR', { message: '일정이 바뀌었거나 같은 장소가 여러 번 있어요. 다시 골라 주세요.' });
    await this.moments.save({ tripId: trip.record.id, userId: ctx.userId, expectedRevision, dayKey: day.dayKey,
      spotKey, spotName: selected?.name ?? null });
    return this.get(ctx, tripId, dayIndex);
  }
}
