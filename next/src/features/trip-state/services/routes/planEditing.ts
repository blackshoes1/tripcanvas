// 일정을 미리 보고 고치는 라우트 — 미리보기는 저장하지 않고, 저장은 전부 `persist`(revision CAS)를 지난다.
import type {
  ApiError, ApiErrorCode, BookingCandidate, BookingListResponse, DeviceRegistration,
  ImportCommitResponse, ImportPreviewResponse, MemoryCreateResponse, MemoryEvent, MemoryListResponse,
  MutationResponse, NotificationPlanItem, PlanPreviewResponse, TodayResponse, TravelStateResponse, TripListResponse
} from '../../domain/contract';
import { CONTRACT_SCHEMA_VERSION } from '../../domain/contract';
import type { PriceObservation } from '../../domain/bookingsView';
import { buildBookings } from '../../domain/bookingsView';
import type { SettableStatus } from '../../domain/mutations';
import { applyActivityStatus, applySuggestion } from '../../domain/mutations';
import type { TodayInput, TripDoc } from '../../domain/todayView';
import { buildDayPlanView } from '../../domain/dayPlanView';
import { computeToday, resolveDayIndex, summarizeTrip } from '../../domain/todayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import collab from '@legacy/collab.js';
import lib from '@legacy/lib.js';
import { fail, ok, readDayIndex, readPlanPreviewBody, resolveClock, type HandlerKit } from '../handlerKit';

export function createPlanEditingHandlers(kit: HandlerKit) {
  const { deps, now, auth, loadTrip, withTrip, todayFor, fxFor, readBody, persist } = kit;

  /** POST /api/v1/trips/:tripId/replan-preview — 미리보기만. 아무것도 저장하지 않는다. */
  async function replanPreview(request: Request, tripId: string): Promise<Response> {
    return withTrip(request, tripId, async ({ gateway, row }) => {
      const response = await todayFor(gateway, row, new URL(request.url));
      return ok({ schemaVersion: CONTRACT_SCHEMA_VERSION, replan: response.replan, today: response });
    });
  }

  /** POST /trips/:tripId/plan-preview — 사용자가 만든 초안과 저장된 하루를 비교한다. 저장·경로 조회는 하지 않는다. */
  async function planPreview(request: Request, tripId: string): Promise<Response> {
    return withTrip(request, tripId, async ({ gateway, row }) => {
      if (row.role != null && !collab.canEdit(row.role)) return fail('FORBIDDEN');

      const body = await readPlanPreviewBody(request);
      if (!body || typeof body.revision !== 'number' || !Number.isSafeInteger(body.revision) || body.revision < 0
        || typeof body.dayIndex !== 'number' || !Number.isSafeInteger(body.dayIndex) || body.dayIndex < 0) return fail('BAD_REQUEST');
      if (body.revision !== row.revision) return fail('REVISION_CONFLICT', { revision: row.revision });
      const normalized = lib.validateTripPayload(body.document);
      if (!normalized.ok) return fail('BAD_REQUEST', { message: normalized.error });
      const draft = normalized.value as TripDoc;
      draft.id = row.client_id;
      const dayIndex = body.dayIndex;
      if (!row.data.days?.[dayIndex] || !draft.days?.[dayIndex]) return fail('DAY_NOT_FOUND');

      // 미리보기는 저장 전 초안이다. wait=0으로 캐시만 읽고 fillLater도 부르지 않는다.
      const readCache = async (trip: TripDoc): Promise<LegCache> => {
        try { return (await deps.legs?.read(trip, dayIndex, 0))?.cache ?? {}; } catch { return {}; }
      };
      const [beforeCache, afterCache, fx] = await Promise.all([readCache(row.data), readCache(draft), fxFor()]);
      const generatedAt = now().toISOString();
      const stamp = generatedAt.slice(0, 10);
      const todayISO = resolveClock(row.data, dayIndex, new URL(request.url), now()).todayISO;
      const before = buildDayPlanView({ trip: row.data, di: dayIndex, summary: summarizeTrip(row, stamp), generatedAt,
        legCache: beforeCache, legsPending: 0, fx, todayISO });
      const after = buildDayPlanView({ trip: draft, di: dayIndex, summary: summarizeTrip({ ...row, data: draft }, stamp), generatedAt,
        legCache: afterCache, legsPending: 0, fx, todayISO });
      if (!before || !after) return fail('DAY_NOT_FOUND');
      const response: PlanPreviewResponse = { before, after };
      return ok(response);
    });
  }

  /** POST /api/v1/trips/:tripId/activities/:activityId/:action  (complete | skip | reset) */
  async function activityAction(request: Request, tripId: string, activityId: string, action: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const status: SettableStatus | null =
      action === 'complete' ? 'COMPLETED' : action === 'skip' ? 'SKIPPED' : action === 'reset' ? 'PLANNED' : null;
    if (!status) return fail('BAD_REQUEST');
    const row = await loadTrip(gateway, tripId);
    if (row instanceof Response) return row;

    const body = await readBody(request);
    const expected = body.expectedRevision;
    const expectedName = typeof body.expectedName === 'string' ? body.expectedName : undefined;

    const result = applyActivityStatus(row.data, activityId, status, expectedName);
    // revision이 다르면 먼저 지금 문서에 적용해 본다 — 응답을 못 받고 다시 보낸 요청은 저장 전 revision을 싣고 오는데,
    // 그때 문서는 이미 그 상태다(§27 같은 결과). 실제로 바꿔야 할 때만 충돌이다. 위치(d0s1)는 revision이 다르면
    // 다른 장소를 가리킬 수 있으므로 이름(expectedName)이 맞을 때만 '이미 그 상태'를 믿는다.
    if (typeof expected === 'number' && expected !== row.revision && !(result.alreadyApplied && expectedName != null)) {
      return fail('REVISION_CONFLICT', { revision: row.revision });
    }
    if (!result.ok) {
      return result.error === 'NAME_MISMATCH'
        ? fail('SUGGESTION_STALE', { message: '그 사이 일정 순서가 바뀌었어요 — 새로 불러온 뒤 다시 시도해 주세요.', revision: row.revision })
        : fail('ACTIVITY_NOT_FOUND');
    }
    return persist(gateway, row, result.trip, new URL(request.url), result.applied, result.alreadyApplied);
  }

  /** POST /api/v1/trips/:tripId/suggestions/:action  (accept | skip), body: { suggestionId } */
  async function suggestionAction(request: Request, tripId: string, action: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    if (action !== 'accept' && action !== 'skip') return fail('BAD_REQUEST');
    const row = await loadTrip(gateway, tripId);
    if (row instanceof Response) return row;

    const body = await readBody(request);
    const suggestionId = typeof body.suggestionId === 'string' ? body.suggestionId : '';
    if (!suggestionId) return fail('BAD_REQUEST');
    // 거절은 문서를 바꾸지 않으니 revision과 무관하다. 수락은 문서를 실제로 바꿀 때만 revision을 따진다(아래).
    const expected = body.expectedRevision;
    const behind = action === 'accept' && typeof expected === 'number' && expected !== row.revision;
    const conflict = () => fail('REVISION_CONFLICT', { revision: row.revision });

    const url = new URL(request.url);
    const dayIndex = readDayIndex(url);
    const clock = resolveClock(row.data, dayIndex ?? null, url, now());
    const dismissed = await gateway.listDismissed(tripId, clock.todayISO).catch((): string[] => []);
    // 클라이언트가 보낸 id로 '서버가 방금 다시 계산한' 제안을 찾는다 — 인덱스를 그대로 믿지 않는다.
    const computed = computeToday({
      tripId, trip: row.data, revision: row.revision, updatedAt: row.updated_at,
      todayISO: clock.todayISO, nowMinutes: clock.nowMinutes, dayIndex, dismissed, generatedAt: now().toISOString()
    });
    const raw = computed.rawSuggestions.find((s) => s.id === suggestionId);
    const result = action === 'accept' && raw ? applySuggestion(
      row.data, computed.dayIndex,
      { id: raw.id, type: raw.type, title: raw.title, action: raw.action as { kind?: string; si?: number | null; fromDay?: number | null; drop?: string[] } },
      computed.windowAfterId
    ) : null;
    if (action === 'accept' && !result?.ok) {
      // 이미 반영한 수락을 다시 보냈다(응답 유실) — 첫 요청이 문서를 바꿔 그 제안은 사라졌거나 더는 적용할 것이 없다
      // (옮겨 온 장소는 같은 id의 '방문' 제안이 된다). 같은 결과이니 충돌이 아니다. ACCEPTED는 저장이 성공한 뒤에만
      // 남으므로(아래) 이 기록이 있으면 그 변경은 이미 문서에 들어가 있다. 지금 다시 바꿔야 한다면 여기 오지 않는다.
      const accepted = await gateway.listAccepted(tripId, clock.todayISO).catch((): string[] => []);
      if (accepted.includes(suggestionId)) {
        const again: MutationResponse = {
          schemaVersion: CONTRACT_SCHEMA_VERSION, applied: false, alreadyApplied: true, revision: row.revision,
          today: await todayFor(gateway, row, url)
        };
        return ok(again);
      }
      return behind ? conflict() : fail('SUGGESTION_STALE');
    }
    // 이미 거절한 제안을 또 건너뛰는 것은 오류가 아니다(같은 결과) — 수락만 신선도를 요구한다.
    if (!raw && !(action === 'skip' && dismissed.includes(suggestionId))) return fail('SUGGESTION_STALE');
    // 낡은 revision의 수락은 지금 문서에 적용해 본 뒤, 실제로 바꿔야 할 때만 충돌이다 — 기록(ACCEPTED)을 남기기 전에 끊는다
    if (behind && result?.applied) return conflict();

    if (!result) {
      await gateway.recordFeedback(tripId, clock.todayISO, suggestionId, 'SKIPPED').catch(() => undefined);
      const body2: MutationResponse = {
        schemaVersion: CONTRACT_SCHEMA_VERSION, applied: true, alreadyApplied: !raw, revision: row.revision,
        today: await todayFor(gateway, row, url)
      };
      return ok(body2);
    }
    const saved = await persist(gateway, row, result.trip, url, result.applied, result.alreadyApplied);
    // 수락 기록은 저장이 성공한 뒤에만 — 실패한 저장이 ACCEPTED를 남기면 위의 재시도 판정이 반영되지 않은 수락을 '이미 했다'고 믿는다
    if (saved.ok) await gateway.recordFeedback(tripId, clock.todayISO, suggestionId, 'ACCEPTED').catch(() => undefined);
    return saved;
  }

  /** GET /api/v1/trips/:tripId/bookings — 여행 당일에 필요한 것만: 시간·장소·상태·번호·링크 */
  async function bookings(request: Request, tripId: string): Promise<Response> {
    return withTrip(request, tripId, async ({ gateway, row }) => {
      const url = new URL(request.url);
      const clock = resolveClock(row.data, readDayIndex(url) ?? null, url, now());
      // 가격 관측이 없어도 예약 목록 자체는 보여야 한다 — 가격은 없으면 없는 대로.
      const observations = await gateway.listPriceObservations(tripId).catch((): PriceObservation[] => []);
      const body: BookingListResponse = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        bookings: buildBookings(row.data, observations, clock.todayISO)
      };
      return ok(body);
    });
  }

  return { replanPreview, planPreview, activityAction, suggestionAction, bookings };
}
