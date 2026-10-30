import { ApiError } from '../api/errors';
import type { RequestContext } from '../auth/types';
import type { TripView } from '../repositories/types';
import type { LiveActivityArrival, LiveActivityRegistration, LiveActivityRepository } from './types';
import { resolveArrivedActivityId } from '@/features/trip-state/domain/arrivalEvidence';
import type { TripDoc } from '@/features/trip-state/domain/todayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import { resolveClock } from '@/features/trip-state/services/handlerKit';

export const LIVE_ACTIVITY_LIFETIME_MS = 8 * 60 * 60 * 1000;

export class LiveActivityService {
  constructor(private readonly deps: {
    repo: LiveActivityRepository;
    tripFor(ctx: RequestContext, tripId: string): Promise<TripView>;
    configured: boolean;
    now?: () => Date;
    cachedLegs?: (trip: TripDoc, dayIndex: number) => Promise<LegCache>;
  }) {}

  private session(ctx: RequestContext): string {
    if (ctx.tokenSource !== 'tripcanvas' || !ctx.sessionId) throw new ApiError('UNAUTHORIZED');
    return ctx.sessionId;
  }

  async register(ctx: RequestContext, input: LiveActivityRegistration) {
    const sessionId = this.session(ctx);
    if (!this.deps.configured) throw new ApiError('SERVICE_UNAVAILABLE');
    const now = this.deps.now?.() ?? new Date();
    const startedAt = new Date(input.startedAtISO);
    const expiresAt = new Date(startedAt.getTime() + LIVE_ACTIVITY_LIFETIME_MS);
    if (!Number.isFinite(startedAt.getTime()) || startedAt.getTime() > now.getTime() + 60_000 || expiresAt <= now) {
      throw new ApiError('VALIDATION_ERROR', { message: '잠금화면 안내의 시작 시각을 다시 확인해 주세요.' });
    }
    const trip = await this.deps.tripFor(ctx, input.tripId);
    const result = await this.deps.repo.register({
      userId: ctx.userId, deviceId: input.deviceId, activityId: input.activityId,
      sessionId, tripId: trip.record.id, pushToken: input.pushToken,
      environment: input.environment, startedAt, expiresAt, now, tokenRevision: input.tokenRevision
    });
    if (result === 'unauthorized') throw new ApiError('UNAUTHORIZED');
    if (result === 'limit') throw new ApiError('RATE_LIMITED');
    if (result === 'stale') throw new ApiError('STALE_VERSION');
    if (result === 'ended') throw new ApiError('CONFLICT', { message: '이미 종료한 안내예요. 여행 중 안내를 다시 시작해 주세요.' });
    return { registered: true, expiresAtISO: expiresAt.toISOString() };
  }

  async stop(ctx: RequestContext, deviceId: string, activityId: string) {
    await this.deps.repo.stop({ userId: ctx.userId, deviceId, activityId,
      sessionId: this.session(ctx), now: this.deps.now?.() ?? new Date() });
    return { removed: true };
  }

  async arrival(ctx: RequestContext, input: LiveActivityArrival) {
    const sessionId = this.session(ctx);
    if (!this.deps.configured) throw new ApiError('SERVICE_UNAVAILABLE');
    let now = this.deps.now?.() ?? new Date();
    const observed = Date.parse(input.observedAtISO);
    // 저장된 도착은 종료까지 유지한다. 새로 접수하는 관측에만 신선도 제한을 둔다.
    if (!Number.isFinite(observed) || observed > now.getTime() + 60_000 || observed < now.getTime() - 15 * 60_000) {
      throw new ApiError('VALIDATION_ERROR', { message: '도착을 확인한 시각이 오래됐어요. 위치를 다시 확인해 주세요.' });
    }
    const trip = await this.deps.tripFor(ctx, input.tripId);
    const document = trip.record.data as TripDoc;
    const legCache = await this.deps.cachedLegs?.(document, input.target.dayIndex) ?? {};
    now = this.deps.now?.() ?? new Date();
    const clock = resolveClock(document, input.target.dayIndex, new URL('http://arrival.invalid'), now);
    const arrival = { target: input.target, arrived: input.arrived, observedAtISO: input.observedAtISO };
    if (!resolveArrivedActivityId({ trip: document, revision: trip.record.revision, ...clock,
      arrival: { ...arrival, arrived: true }, legCache })) throw new ApiError('STALE_VERSION');
    const result = await this.deps.repo.recordArrival({ userId: ctx.userId, deviceId: input.deviceId,
      activityId: input.activityId, sessionId, tripId: trip.record.id, arrival, eventRevision: input.eventRevision, now });
    if (result === 'unauthorized') throw new ApiError('UNAUTHORIZED');
    if (result === 'stale') throw new ApiError('STALE_VERSION');
    if (result === 'missing' || result === 'ended') throw new ApiError('CONFLICT', { message: '잠금화면 안내를 먼저 연결한 뒤 도착을 확인해 주세요.' });
    return { recorded: true };
  }
}
