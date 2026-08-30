// Booking 도메인 연산 — 순수(§9). 판단 규칙은 레거시 bkSave/bkDelBtn 핸들러와 동일하게 유지하고
// (동작 변경 금지 — §28), 저장은 services/hooks가 담당한다.
import legacyLib from '@legacy/lib.js';

import type { Trip } from '@/features/trip/domain/types';
import type { Booking } from './types';

export type DraftError =
  | 'TITLE_REQUIRED'
  | 'PRICE_REQUIRED'
  | 'TRACK_NEEDS_DATES'
  | 'RETURN_BEFORE_PICKUP'
  | 'SAME_DAY_NEEDS_TIMES'
  | 'CHECKOUT_NOT_AFTER_CHECKIN';

const HM = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * 저장 전 검증 — 레거시 규칙 그대로:
 * - 숙박: start >= end 거부 (당일 체크아웃 없음)
 * - 렌터카: 당일 대여는 정상 — 같은 날이면 픽업 시각 < 반납 시각 필요 (시세 조회도 pickupAt<returnAt만 본다)
 * - 호텔 + 추적 on이면 기간 필수
 */
export function validateBookingDraft(b: Booking): { ok: true } | { ok: false; error: DraftError } {
  if (!b.title?.trim()) return { ok: false, error: 'TITLE_REQUIRED' };
  if (!(b.price > 0)) return { ok: false, error: 'PRICE_REQUIRED' };
  if (b.type === 'hotel' && b.track && (!b.start || !b.end)) return { ok: false, error: 'TRACK_NEEDS_DATES' };
  if (b.start && b.end) {
    if (b.type === 'car') {
      if (b.start > b.end) return { ok: false, error: 'RETURN_BEFORE_PICKUP' };
      if (b.start === b.end) {
        const pt = b.carPickupTime ?? '', rt = b.carReturnTime ?? '';
        if (!HM.test(pt) || !HM.test(rt) || legacyLib.parseHM(pt) >= legacyLib.parseHM(rt))
          return { ok: false, error: 'SAME_DAY_NEEDS_TIMES' };
      }
    } else if (b.start >= b.end) return { ok: false, error: 'CHECKOUT_NOT_AFTER_CHECKIN' };
  }
  return { ok: true };
}

/** 예약 추가/수정 — 불변 갱신. 정규화(normalizeBooking)를 통과 못 하는 항목은 넣지 않는다. */
export function upsertBooking(trip: Trip, booking: Booking): Trip {
  const normalized = legacyLib.normalizeBooking(booking) as Booking | null;
  if (!normalized) return trip;
  const bookings = [...(trip.bookings ?? [])];
  const i = bookings.findIndex(x => x.id === normalized.id);
  if (i >= 0) bookings[i] = normalized;
  else bookings.push(normalized);
  return { ...trip, bookings };
}

/**
 * 예약 삭제 — 골든 규칙: 스팟에 남은 참조(bookingId·carPickupId·carReturnId)를 모두 정리하고,
 * 목록이 비면 bookings 키 자체를 제거한다(공유 링크 크기 절약 — 레거시와 동일).
 */
export function deleteBooking(trip: Trip, id: string): Trip {
  const bookings = (trip.bookings ?? []).filter(b => b.id !== id);
  const days = trip.days.map(d => ({
    ...d,
    spots: d.spots.map(s => {
      if (s.bookingId !== id && s.carPickupId !== id && s.carReturnId !== id) return s;
      const next = { ...s };
      if (next.bookingId === id) delete next.bookingId;
      if (next.carPickupId === id) delete next.carPickupId;
      if (next.carReturnId === id) delete next.carReturnId;
      return next;
    })
  }));
  const next: Trip = { ...trip, days, bookings };
  if (!bookings.length) delete next.bookings;
  return next;
}

/** 클라이언트 생성 id — 레거시 uid()와 같은 강도(참조·정규화 _ID_RE 통과) */
export function newBookingId(): string {
  return 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
