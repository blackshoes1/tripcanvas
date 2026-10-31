import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../auth/types';
import type { TripView } from '../repositories/types';
import type { LiveActivityRepository } from '../live-activities/types';
import { LiveActivityService } from '../live-activities/service';
import { createLiveActivityRoutes } from './liveActivityRoutes';
import { ApiError } from './errors';

const now = new Date('2026-10-27T09:00:00Z');
const ctx: RequestContext = { userId: 'u', sessionId: 'session', tokenSource: 'tripcanvas', email: null, legacySupabaseUserId: null };
const body = { deviceId: 'd', activityId: 'a', tripId: 'trip', pushToken: 'ab'.repeat(32),
  environment: 'production', startedAtISO: now.toISOString(), tokenRevision: 123 };
const request = (value: unknown = body, token = 'bearer-not-stored') => new Request('https://api.test/api/v1/live-activities', {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(value)
});
let repo: LiveActivityRepository;
let tripFor: ReturnType<typeof vi.fn<(actor: RequestContext, tripId: string) => Promise<TripView>>>;
let routes: ReturnType<typeof createLiveActivityRoutes>;
let configured: boolean;
beforeEach(() => {
  configured = true;
  repo = { register: vi.fn().mockResolvedValue('registered'), stop: vi.fn(), claimDue: vi.fn(),
    delivery: vi.fn(), complete: vi.fn(), retry: vi.fn(), discard: vi.fn(), recordArrival: vi.fn(), readArrival: vi.fn() };
  tripFor = vi.fn().mockResolvedValue({ record: { id: 'trip-row-uuid' } } as TripView);
  routes = createLiveActivityRoutes({ verifier: { verify: async token => token === 'bad' ? null : ctx },
    serviceFor: async () => new LiveActivityService({ repo, tripFor, configured, now: () => now }) });
});
describe('Live Activity 등록 API', () => {
  it('인증된 세션 ID와 읽기 권한 확인 결과만 저장하고 원문 bearer는 저장하지 않는다', async () => {
    const result = await routes.register(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ registered: true, expiresAtISO: '2026-10-27T17:00:00.000Z' });
    expect(tripFor).toHaveBeenCalledWith(ctx, 'trip');
    expect(repo.register).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session', tripId: 'trip-row-uuid', tokenRevision: 123 }));
    expect(JSON.stringify(vi.mocked(repo.register).mock.calls)).not.toContain('bearer-not-stored');
  });
  it('미인증과 세션 ID 없는 레거시 인증은 401이다', async () => {
    expect((await routes.register(request(body, 'bad'))).status).toBe(401);
    const legacy = createLiveActivityRoutes({ verifier: { verify: async () => ({ ...ctx, sessionId: null, tokenSource: 'supabase' }) },
      serviceFor: async () => new LiveActivityService({ repo, tripFor, configured, now: () => now }) });
    expect((await legacy.register(request())).status).toBe(401);
    expect(repo.register).not.toHaveBeenCalled();
  });
  it('여행 읽기 권한이 없으면 등록하지 않는다', async () => {
    tripFor.mockRejectedValue(new ApiError('NOT_FOUND'));
    expect((await routes.register(request())).status).toBe(404);
    expect(repo.register).not.toHaveBeenCalled();
  });
  it('APNs 미설정은 503이며 종료 정리는 계속 가능하다', async () => {
    configured = false;
    const result = await routes.register(request());
    expect(result.status).toBe(503);
    expect((await result.json()).code).toBe('SERVICE_UNAVAILABLE');
    expect(repo.register).not.toHaveBeenCalled();
    const deleted = await routes.stop(new Request('https://api.test/api/v1/live-activities?deviceId=d&activityId=a', {
      method: 'DELETE', headers: { authorization: 'Bearer any' } }));
    expect(deleted.status).toBe(200);
    expect(repo.stop).toHaveBeenCalledWith({ userId: 'u', deviceId: 'd', activityId: 'a', sessionId: 'session', now });
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined])('안전한 양의 tokenRevision이 아니면 400이다: %s', async revision => {
    expect((await routes.register(request({ ...body, tokenRevision: revision }))).status).toBe(400);
  });
  it.each(['2026-10-27T00:59:59Z', '2026-10-27T09:01:01Z', 'bad'])('8시간 과거·미래·잘못된 시작 시각은 거절한다: %s', async startedAtISO => {
    expect((await routes.register(request({ ...body, startedAtISO }))).status).toBe(400);
  });
  it('토큰은 고정 길이를 가정하지 않지만 hex·상한·본문 크기를 검증한다', async () => {
    expect((await routes.register(request({ ...body, pushToken: 'a'.repeat(130) }))).status).toBe(200);
    expect((await routes.register(request({ ...body, pushToken: 'not-hex' }))).status).toBe(400);
    expect((await routes.register(request({ ...body, pushToken: 'a'.repeat(65) }))).status).toBe(400);
    expect((await routes.register(request({ ...body, pushToken: 'a'.repeat(513) }))).status).toBe(400);
    expect((await routes.register(request({ ...body, padding: 'x'.repeat(5000) }))).status).toBe(400);
  });
  it.each([['stale', 409], ['ended', 409], ['limit', 429], ['unauthorized', 401]] as const)('저장소 결과 %s를 정직하게 응답한다', async (result, status) => {
    vi.mocked(repo.register).mockResolvedValue(result);
    expect((await routes.register(request())).status).toBe(status);
  });
});

describe('Live Activity 도착 근거 API', () => {
  const arrival = { deviceId: 'd', activityId: 'a', tripId: 'trip',
    target: { dayIndex: 0, activityId: 'd0s0', revision: 1 }, arrived: true,
    observedAtISO: now.toISOString(), eventRevision: 1 };
  beforeEach(() => {
    repo.recordArrival = vi.fn().mockResolvedValue('recorded');
    repo.readArrival = vi.fn();
    tripFor.mockResolvedValue({ record: { id: 'trip-row-uuid', clientId: 'trip', revision: 1,
      updatedAt: now.toISOString(), data: { start: '2026-10-27', timeZone: 'UTC',
        days: [{ startAt: '09:00', spots: [{ name: '조기 도착', at: '12:00', stayMin: 60, lat: 40, lng: -3 }] }] } } } as TripView);
  });
  it('읽기 권한과 정확한 일정 근거를 확인하고 좌표·bearer 없이 기록한다', async () => {
    const result = await routes.arrival(request(arrival));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ recorded: true });
    expect(repo.recordArrival).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u', sessionId: 'session',
      tripId: 'trip-row-uuid', eventRevision: 1, arrival: { target: arrival.target, arrived: true, observedAtISO: arrival.observedAtISO } }));
    expect(JSON.stringify(vi.mocked(repo.recordArrival).mock.calls)).not.toMatch(/bearer-not-stored|"lat"|"lng"/);
  });
  it('인증·여행 읽기 권한이 없으면 저장하지 않는다', async () => {
    expect((await routes.arrival(request(arrival, 'bad'))).status).toBe(401);
    tripFor.mockRejectedValue(new ApiError('NOT_FOUND'));
    expect((await routes.arrival(request(arrival))).status).toBe(404);
    expect(repo.recordArrival).not.toHaveBeenCalled();
  });
  it.each([true, false])('예정 체류가 끝난 장소의 새 관측도 세션·일정 검사 후 기록한다: %s', async arrived => {
    tripFor.mockResolvedValue({ record: { id: 'trip-row-uuid', clientId: 'trip', revision: 1,
      updatedAt: now.toISOString(), data: { start: '2026-10-27', timeZone: 'UTC',
        days: [{ startAt: '08:00', spots: [
          { name: '머무는 곳', at: '08:00', stayMin: 30, lat: 40, lng: -3 },
          { name: '다음 예약', at: '12:00', stayMin: 60, lat: 40.01, lng: -3 }
        ] }] } } } as TripView);
    expect((await routes.arrival(request({ ...arrival, arrived }))).status).toBe(200);
    expect(repo.recordArrival).toHaveBeenCalledWith(expect.objectContaining({
      userId: ctx.userId, sessionId: ctx.sessionId, tripId: 'trip-row-uuid',
      arrival: { target: arrival.target, arrived, observedAtISO: arrival.observedAtISO }
    }));
  });
  it.each([
    { target: { ...arrival.target, revision: 2 } },
    { target: { ...arrival.target, dayIndex: 1 } },
    { target: { ...arrival.target, activityId: 'd0s9' } },
    { observedAtISO: '2026-10-27T09:05:00Z' },
    { observedAtISO: '2026-10-27T08:44:59Z' },
    { lat: 40, lng: -3 },
    { eventRevision: 0 }, { eventRevision: 1.5 }
  ])('낡거나 다른 일정·미래 시각·잘못된 순서는 거절한다: %j', async extra => {
    expect((await routes.arrival(request({ ...arrival, ...extra }))).status).not.toBe(200);
    expect(repo.recordArrival).not.toHaveBeenCalled();
  });
  it.each([['missing', 409], ['ended', 409], ['stale', 409], ['unauthorized', 401]] as const)(
    '활성 등록 검사 결과 %s를 성공으로 숨기지 않는다', async (result, status) => {
      vi.mocked(repo.recordArrival).mockResolvedValue(result);
      expect((await routes.arrival(request(arrival))).status).toBe(status);
    });
});
