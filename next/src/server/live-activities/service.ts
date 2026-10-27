import { ApiError } from '../api/errors';
import type { RequestContext } from '../auth/types';
import type { TripView } from '../repositories/types';
import type { LiveActivityRegistration, LiveActivityRepository } from './types';

export const LIVE_ACTIVITY_LIFETIME_MS = 8 * 60 * 60 * 1000;

export class LiveActivityService {
  constructor(private readonly deps: {
    repo: LiveActivityRepository;
    tripFor(ctx: RequestContext, tripId: string): Promise<TripView>;
    configured: boolean;
    now?: () => Date;
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
}
