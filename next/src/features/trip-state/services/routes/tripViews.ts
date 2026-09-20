// 여행을 읽어 계산해 보여 주는 라우트 — 목록 · 지금 · 하루치 · 전체 동선 · 비용 · 여행 상태.
import type {
  ApiError, ApiErrorCode, BookingCandidate, BookingListResponse, DeviceRegistration,
  ImportCommitResponse, ImportPreviewResponse, MemoryCreateResponse, MemoryEvent, MemoryListResponse,
  MutationResponse, NotificationPlanItem, PlanPreviewResponse, TodayResponse, TravelStateResponse, TripListResponse
} from '../../domain/contract';
import { CONTRACT_SCHEMA_VERSION } from '../../domain/contract';
import { buildTravelState } from '../../domain/travelState';
import { buildDayPlanView } from '../../domain/dayPlanView';
import { buildTripCosts } from '../../domain/tripCostsView';
import { buildTripRoutes } from '../../domain/tripRoutesView';
import { computeToday, resolveDayIndex, summarizeTrip } from '../../domain/todayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import lib from '@legacy/lib.js';
import { LEG_WAIT_MS, fail, ok, readDayIndex, readLocation, readMinutes, resolveClock, type HandlerKit, type TripRow } from '../handlerKit';

export function createTripViewsHandlers(kit: HandlerKit) {
  const { deps, now, auth, withTrip, todayFor, fxFor, legCacheFor } = kit;

  /** GET /api/v1/trips — 여행 목록. 삭제(tombstone)된 여행은 빼고, 최근 수정 순. */
  async function trips(request: Request): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    let rows: TripRow[];
    try { rows = await gateway.listTrips(); } catch { return fail('UPSTREAM_ERROR'); }
    const stamp = now().toISOString().slice(0, 10);
    const body: TripListResponse = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      trips: rows.filter((r) => !r.deleted_at).map((r) => summarizeTrip(r, stamp))
    };
    return ok(body);
  }

  /** GET /api/v1/trips/:tripId/today */
  async function today(request: Request, tripId: string): Promise<Response> {
    return withTrip(request, tripId, async ({ gateway, row }) => {
      const url = new URL(request.url);
      const response = await todayFor(gateway, row, url);
      // "지금" 화면도 그 날의 구간을 쓴다 — 여기서도 못 채운 것을 응답 뒤에 채운다.
      deps.legs?.fillLater(row.data, response.day.index);
      return ok(response);
    });
  }

  /**
   * GET /api/v1/trips/:tripId/days/:dayIndex — 그 날 전체가 어떻게 흐르는가.
   *
   * Today가 "지금 무엇을"이라면 이쪽은 일정 화면이 쓰는 하루치다. 계산은 전부
   * `buildDayPlanView`(그 안은 `dayView.ts` → `lib.js`)가 하고 여기서는 권한과 모양만 본다.
   */
  async function dayPlan(request: Request, tripId: string, dayIndex: number): Promise<Response> {
    return withTrip(request, tripId, async ({ gateway, row }) => {
      const stamp = now().toISOString().slice(0, 10);
      // 결제일이 상태를 정하므로 Today와 같은 시계(여행 시간대의 오늘)를 쓴다 — 기기 날짜와 어긋나면 같은 항목이 두 답을 낸다.
      const clock = resolveClock(row.data, dayIndex, new URL(request.url), now());
      const [legs, fx] = await Promise.all([legCacheFor(row.data, dayIndex), fxFor()]);
      const body = buildDayPlanView({
        trip: row.data, di: dayIndex,
        summary: summarizeTrip(row, stamp), generatedAt: now().toISOString(),
        legCache: legs.cache, legsPending: legs.pending, fx, todayISO: clock.todayISO
      });
      // 없는 날을 지어내지 않는다 — 여행은 있는데 그 일자가 없으면 404다.
      if (!body) return fail('DAY_NOT_FOUND');
      // 못 채운 구간은 응답을 보낸 뒤에 채운다. 기다리면 그만큼 화면이 늦는다.
      deps.legs?.fillLater(row.data, dayIndex);
      return ok(body);
    });
  }

  /**
   * GET /api/v1/trips/:tripId/routes — 여행 **전체**의 동선.
   *
   * 일자별 지도는 `days/:i`로 충분하지만, 전체를 한 화면에 보려면 며칠치를 한 번에 받아야 한다
   * (14일 여행을 하루씩 받으면 왕복이 14번이다). 그리는 데 필요한 것만 담는다.
   */
  async function tripRoutes(request: Request, tripId: string): Promise<Response> {
    return withTrip(request, tripId, async ({ gateway, row }) => {

      // 전체를 보겠다고 한 순간이므로 여기서는 여행 전부를 채운다(상한까지만 기다린다).
      let legs = { cache: {} as LegCache, pending: 0 };
      if (deps.legs) {
        try { legs = await deps.legs.readTrip(row.data, LEG_WAIT_MS); } catch { /* 추정으로 나간다 */ }
      }
      const stamp = now().toISOString().slice(0, 10);
      const body = buildTripRoutes({
        trip: row.data, summary: summarizeTrip(row, stamp), generatedAt: now().toISOString(),
        legCache: legs.cache, legsPending: legs.pending
      });
      deps.legs?.fillTripLater(row.data);
      return ok(body);
    });
  }

  async function tripCosts(request: Request, tripId: string): Promise<Response> {
    return withTrip(request, tripId, async ({ gateway, row }) => {

      // 전체를 보겠다고 한 순간이므로 여기서는 여행 전부를 채운다(상한까지만 기다린다).
      let legs = { cache: {} as LegCache, pending: 0 };
      if (deps.legs) {
        try { legs = await deps.legs.readTrip(row.data, LEG_WAIT_MS); } catch { /* 추정으로 나간다 */ }
      }
      const clock = resolveClock(row.data, null, new URL(request.url), now());
      const body = buildTripCosts(row.data, legs.cache, row.revision, await fxFor(), clock.todayISO);
      deps.legs?.fillTripLater(row.data);
      return ok(body);
    });
  }

  /**
   * GET /api/v1/trips/:tripId/travel-state
   * 여행 중 iOS가 쓰는 단 하나의 조회(§57). Today + Trip Pulse + 출발 계획 + 알림 계획 +
   * 잠금화면/위젯 압축 상태를 한 번에 준다 — 연속 호출은 그대로 배터리다.
   *
   * 위치(lat/lng)는 이번 계산에만 쓰고 저장하지 않는다(§55).
   * markSent=1이면 돌려준 알림을 '보낸 것'으로 기록해 다음 호출에서 빠진다.
   */
  async function travelState(request: Request, tripId: string): Promise<Response> {
    return withTrip(request, tripId, async ({ gateway, row }) => {

      const url = new URL(request.url);
      const dayIndex = readDayIndex(url);
      const clock = resolveClock(row.data, dayIndex ?? null, url, now());
      const [dismissed, sentKeys] = await Promise.all([
        gateway.listDismissed(tripId, clock.todayISO).catch((): string[] => []),
        gateway.listSentNotificationKeys(tripId, clock.todayISO).catch((): string[] => [])
      ]);

      const location = readLocation(url);
      const response = buildTravelState({
        tripId, trip: row.data, revision: row.revision, updatedAt: row.updated_at,
        todayISO: clock.todayISO, nowMinutes: clock.nowMinutes, dayIndex, dismissed,
        generatedAt: now().toISOString(),
        currentLocation: location.point,
        locationUpdatedAt: location.updatedAt,
        travelMode: url.searchParams.get('travelMode') === '1',
        suppressUntilMinutes: readMinutes(url.searchParams.get('suppressUntil')),
        sentNotificationKeys: sentKeys
      });

      if (url.searchParams.get('markSent') === '1' && response.notifications.length) {
        await gateway.recordNotifications(tripId, clock.todayISO,
          response.notifications.map((n: NotificationPlanItem) => ({
            kind: n.kind, dedupeKey: n.dedupeKey, stateVersion: response.stateVersion
          }))).catch(() => undefined);
      }
      return ok(response satisfies TravelStateResponse);
    });
  }

  return { trips, today, dayPlan, tripRoutes, tripCosts, travelState };
}
