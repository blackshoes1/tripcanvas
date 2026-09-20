// 밖에서 들어온 것을 다루는 라우트 — 공유·붙여넣기 미리보기와 확인 저장, 그리고 여행 기록.
// ⚠️ **확인한 것만 저장된다** — 미리보기는 아무것도 남기지 않는다.
import type {
  ApiError, ApiErrorCode, BookingCandidate, BookingListResponse, DeviceRegistration,
  ImportCommitResponse, ImportPreviewResponse, MemoryCreateResponse, MemoryEvent, MemoryListResponse,
  MutationResponse, NotificationPlanItem, PlanPreviewResponse, TodayResponse, TravelStateResponse, TripListResponse
} from '../../domain/contract';
import { CONTRACT_SCHEMA_VERSION } from '../../domain/contract';
import type { MemoryRow, SharedInputPayload } from '../../domain/intakeView';
import {
  associateCapture, buildImportPreview, buildMemoryTimeline, candidateToBookingDoc, toMemoryEvent
} from '../../domain/intakeView';
import type { TodayInput, TripDoc } from '../../domain/todayView';
import collab from '@legacy/collab.js';
import { fail, makeBookingId, ok, readDayIndex, readPoint, resolveClock, type HandlerKit, type TripRow } from '../handlerKit';

export function createIntakeHandlers(kit: HandlerKit) {
  const { deps, now, auth, loadTrip, withTrip, todayFor, readBody } = kit;

  /**
   * POST /api/v1/import/preview — 공유된 것 하나를 훑는다. **아무것도 저장하지 않는다**(§76.2).
   * 무엇인지 · 어느 여행에 붙을지 · 이미 있는 것과 겹치는지까지 한 번에 돌려준다.
   */
  async function importPreview(request: Request): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const body = await readBody(request);
    const payload: SharedInputPayload = {
      url: typeof body.url === 'string' ? body.url : null,
      text: typeof body.text === 'string' ? body.text : null,
      title: typeof body.title === 'string' ? body.title : null,
      sourceType: typeof body.sourceType === 'string' ? body.sourceType : null,
      receivedAt: typeof body.receivedAt === 'string' ? body.receivedAt : null,
      locale: typeof body.locale === 'string' ? body.locale : null,
      currencyHint: typeof body.currencyHint === 'string' ? body.currencyHint : null
    };
    if (!payload.url && !payload.text && !payload.title) return fail('BAD_REQUEST');
    let rows: TripRow[];
    try { rows = await gateway.listTrips(); } catch { return fail('UPSTREAM_ERROR'); }
    const preview: ImportPreviewResponse = buildImportPreview(
      payload,
      rows.filter((r) => !r.deleted_at).map((r) => ({ client_id: r.client_id, data: r.data })),
      { year: now().getUTCFullYear() }
    );
    return ok(preview);
  }

  /**
   * POST /api/v1/trips/:tripId/import/commit — 사용자가 확인한 후보만 저장한다.
   * 저장으로 끝내지 않고 새 예약이 남은 일정과 부딪히는지까지 돌려준다(§42).
   */
  async function importCommit(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const body = await readBody(request);
    const candidate = body.candidate as BookingCandidate | undefined;
    if (!candidate || typeof candidate !== 'object') return fail('BAD_REQUEST');
    const row = await loadTrip(gateway, tripId);
    if (row instanceof Response) return row;
    const expected = body.expectedRevision;
    if (typeof expected === 'number' && expected !== row.revision) return fail('REVISION_CONFLICT', { revision: row.revision });

    const bookingId = makeBookingId(row.data);
    const next: TripDoc = JSON.parse(JSON.stringify(row.data));
    next.bookings = ((next.bookings ?? []) as unknown[]).concat([candidateToBookingDoc(candidate, bookingId)]);

    if (row.role != null && !collab.canEdit(row.role)) return fail('FORBIDDEN');
    let saved;
    try { saved = await gateway.saveTrip(tripId, next, row.revision); } catch { return fail('UPSTREAM_ERROR'); }
    if (saved.forbidden) return fail('FORBIDDEN');
    if (!saved.applied) return fail('REVISION_CONFLICT', { revision: saved.revision });

    const url = new URL(request.url);
    const savedRow: TripRow = { ...row, data: saved.data ?? next, revision: saved.revision, updated_at: new Date().toISOString() };
    const today = await todayFor(gateway, savedRow, url);
    const response: ImportCommitResponse = {
      schemaVersion: CONTRACT_SCHEMA_VERSION, bookingId, revision: saved.revision, replan: today.replan, today
    };
    return ok(response);
  }

  /** GET /api/v1/trips/:tripId/memories?day=N */
  async function memories(request: Request, tripId: string): Promise<Response> {
    return withTrip(request, tripId, async ({ gateway, row }) => {
      const url = new URL(request.url);
      const dayIndex = readDayIndex(url) ?? null;
      let rows: MemoryRow[];
      try { rows = await gateway.listMemories(tripId, dayIndex); } catch { return fail('UPSTREAM_ERROR'); }
      const events: MemoryEvent[] = rows.map(toMemoryEvent);
      const today = await todayFor(gateway, row, url);
      const body: MemoryListResponse = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        events,
        timeline: buildMemoryTimeline(events, today.activities.map((a) => ({ id: a.id, name: a.name, startMinutes: a.startMinutes })))
      };
      return ok(body);
    });
  }

  /**
   * POST /api/v1/trips/:tripId/memories — 사진·메모를 남긴다.
   * 어느 일정인지는 **서버가 시각·위치로 짚어 준다** — 사용자가 다시 고르게 하지 않는다(§27).
   */
  async function createMemory(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const body = await readBody(request);
    const type = String(body.type ?? '');
    if (['PHOTO', 'NOTE', 'VISIT', 'MOMENT'].indexOf(type) < 0) return fail('BAD_REQUEST');
    const row = await loadTrip(gateway, tripId);
    if (row instanceof Response) return row;

    const url = new URL(request.url);
    const today = await todayFor(gateway, row, url);
    const clock = resolveClock(row.data, today.day.index, url, now());
    const atMinutes = typeof body.atMinutes === 'number' ? Math.round(body.atMinutes) : clock.nowMinutes;
    const location = readPoint(body.location);

    // 클라이언트가 activityId를 보내도 그대로 믿지 않는다 — 서버가 다시 짚고 이유를 남긴다.
    const association = associateCapture(
      { atMinutes, location },
      today.activities.map((a) => ({
        id: a.id, name: a.name, startMinutes: a.startMinutes, endMinutes: a.endMinutes, location: a.location
      })));

    const assetRefs = Array.isArray(body.assetRefs)
      ? (body.assetRefs as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 50)
      : [];
    let result;
    try {
      result = await gateway.saveMemory(tripId, {
        day_index: today.day.index,
        activity_id: association.activityId,
        type,
        caption: typeof body.caption === 'string' ? body.caption.slice(0, 2000) : null,
        asset_refs: assetRefs,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        at_minutes: atMinutes,
        captured_at: new Date().toISOString(),
        client_key: typeof body.clientKey === 'string' ? body.clientKey : null
      });
    } catch { return fail('UPSTREAM_ERROR'); }

    const response: MemoryCreateResponse = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      event: toMemoryEvent(result.row),
      association,
      alreadyExists: !result.created
    };
    return ok(response);
  }

  return { importPreview, importCommit, memories, createMemory };
}
