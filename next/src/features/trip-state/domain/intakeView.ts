// 유입(공유·기록) 응답 구성 — 판단은 저장소 루트 intake.js(웹·iOS 공용)가 한다.
//
// 이 계층의 규칙 하나: **아무것도 저장하지 않는다.** 미리보기까지만 만들고,
// 저장은 사용자가 확인한 뒤 별도 요청으로 일어난다(§76.2).
import intake from '@legacy/intake.js';

import type {
  BookingCandidate, DuplicateBookingMatch, ImportPreviewResponse, MemoryEvent,
  MemoryTimelineGroup, ShareKind, TripMatch
} from './contract';
import { CONTRACT_SCHEMA_VERSION } from './contract';
import type { TripDoc } from './todayView';

export interface SharedInputPayload {
  url?: string | null;
  text?: string | null;
  title?: string | null;
  sourceType?: string | null;
  receivedAt?: string | null;
  locale?: string | null;
  currencyHint?: string | null;
}

export interface TripRowLite {
  client_id: string;
  data: TripDoc;
}

/**
 * 공유된 것 하나를 훑어 무엇인지, 어디에 붙을지, 이미 있는 것과 겹치는지 알려 준다.
 * 저장하지 않는다 — 응답을 보고 사용자가 정한다.
 */
export function buildImportPreview(
  input: SharedInputPayload,
  trips: TripRowLite[],
  opts?: { year?: number }
): ImportPreviewResponse {
  const shared = {
    url: input.url ?? undefined,
    text: input.text ?? undefined,
    title: input.title ?? undefined,
    sourceType: input.sourceType ?? undefined,
    receivedAt: input.receivedAt ?? undefined,
    locale: input.locale ?? undefined
  };
  const classification = intake.classifyShare(shared);
  const idempotencyKey = intake.shareIdempotencyKey(shared);

  // 예약으로 볼 만한 것만 후보를 만든다. 장소·메모는 후보를 만들지 않고 그대로 돌려준다 —
  // 모든 공유가 예약이라고 가정하지 않는다(§11).
  const wantsBooking = classification.kind === 'BOOKING' || classification.kind === 'TRANSPORT';
  const raw = wantsBooking
    ? intake.parseBookingCandidate(shared, { locale: input.locale ?? undefined, year: opts?.year, currencyHint: input.currencyHint ?? undefined })
    : null;

  const candidate: BookingCandidate | null = raw
    ? {
      type: raw.type, title: raw.title, provider: raw.provider, providerId: raw.providerId,
      confirmationNumber: raw.confirmationNumber, startAt: raw.startAt, endAt: raw.endAt,
      location: raw.location, amount: raw.amount, currency: raw.currency,
      sourceUrl: raw.sourceUrl, sourceTitle: raw.sourceTitle,
      confidence: raw.confidence, missingFields: raw.missingFields,
      ambiguities: raw.ambiguities, reasons: raw.reasons,
      disposition: intake.candidateDisposition(raw)
    }
    : null;

  // 어느 여행인지 단정하지 않는다 — 점수와 이유를 붙여 고르게 한다(§20).
  const tripMatches: TripMatch[] = candidate
    ? intake.matchTripForBooking(raw, trips.map((t) => ({ ...t.data, id: t.client_id })))
      .map((m) => ({ tripId: m.tripId, name: m.name, score: m.score, reasons: m.reasons }))
    : [];

  // 중복 검사는 후보 여행의 예약 안에서만 본다.
  let duplicate: DuplicateBookingMatch | null = null;
  if (candidate && tripMatches.length) {
    const row = trips.find((t) => t.client_id === tripMatches[0].tripId);
    const found = row ? intake.findDuplicateBooking(raw, (row.data.bookings ?? []) as Record<string, unknown>[]) : null;
    if (found) {
      duplicate = {
        tripId: tripMatches[0].tripId,
        bookingId: String((found.booking as { id?: unknown }).id ?? ''),
        title: String((found.booking as { title?: unknown }).title ?? ''),
        score: found.score,
        reasons: found.reasons
      };
    }
  }

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    idempotencyKey,
    kind: classification.kind as ShareKind,
    kindConfidence: classification.confidence,
    kindReasons: classification.reasons,
    candidate,
    tripMatches,
    duplicate,
    // 못 읽었다고 버리지 않는다 — 메모로 남길 수 있게 원문을 그대로 돌려준다(§50).
    rawText: input.text ?? null,
    rawUrl: input.url ?? null,
    rawTitle: input.title ?? null
  };
}

/** 사용자가 확인한 후보 → 저장할 예약 문서. 여기서도 확정하지 않는다(라우트가 CAS로 저장한다). */
export function candidateToBookingDoc(candidate: BookingCandidate, id: string): Record<string, unknown> {
  return intake.candidateToBooking(candidate, id) as Record<string, unknown>;
}

export interface MemoryRow {
  id: string;
  day_index: number | null;
  activity_id: string | null;
  type: string;
  caption: string | null;
  asset_refs: unknown;
  lat: number | null;
  lng: number | null;
  at_minutes: number | null;
  captured_at: string;
  client_key: string | null;
}

export function toMemoryEvent(row: MemoryRow): MemoryEvent {
  return {
    id: row.id,
    dayIndex: row.day_index,
    activityId: row.activity_id,
    type: row.type as MemoryEvent['type'],
    caption: row.caption,
    assetRefs: Array.isArray(row.asset_refs) ? (row.asset_refs as string[]) : [],
    location: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null,
    atMinutes: row.at_minutes,
    capturedAt: row.captured_at,
    clientKey: row.client_key
  };
}

/**
 * 기록 하나를 어느 일정에 붙일지. 시각이 먼저고, 애매하면 위치로, 그래도 아니면 날짜에만 붙인다.
 * 사용자에게 "어디였죠?"를 다시 묻지 않기 위한 것이다(§27).
 */
export function associateCapture(
  capture: { atMinutes: number; location?: { lat: number; lng: number } | null },
  activities: { id: string; name: string; startMinutes: number; endMinutes: number; location: { lat: number; lng: number } | null }[]
): { activityId: string | null; reason: string } {
  return intake.associateMemory(capture, activities);
}

export function buildMemoryTimeline(
  events: MemoryEvent[],
  activities: { id: string; name: string; startMinutes: number }[]
): MemoryTimelineGroup[] {
  return intake.memoryTimeline(events, activities).map((g) => ({
    activityId: g.activityId,
    title: g.title,
    atMinutes: g.atMinutes,
    photos: g.photos,
    notes: g.notes,
    eventIds: (g.events as { id?: unknown }[]).map((e) => String(e.id ?? ''))
  }));
}
