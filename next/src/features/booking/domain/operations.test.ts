// Golden parity — 예약 검증·삭제 규칙이 레거시(bkSave/bkDelBtn·integration 골든 테스트)와 같음을 고정
import { describe, expect, it } from 'vitest';

import type { Trip } from '@/features/trip/domain/types';
import type { CarBooking, HotelBooking } from './types';
import { deleteBooking, upsertBooking, validateBookingDraft } from './operations';

const car = (over: Partial<CarBooking> = {}): CarBooking => ({
  id: 'bc', type: 'car', title: '경차', price: 80000, track: true,
  start: '2026-08-01', end: '2026-08-01', carPickupTime: '09:00', carReturnTime: '19:00', ...over
});
const hotel = (over: Partial<HotelBooking> = {}): HotelBooking => ({
  id: 'bh', type: 'hotel', title: 'H', price: 100000, track: true,
  start: '2026-08-01', end: '2026-08-02', ...over
});

describe('validateBookingDraft — 레거시 저장 규칙 동일', () => {
  it('당일 렌터카는 정상 — 같은 날이면 픽업<반납 시각이 가른다', () => {
    expect(validateBookingDraft(car()).ok).toBe(true);
    expect(validateBookingDraft(car({ carPickupTime: '19:00', carReturnTime: '09:00' })))
      .toMatchObject({ ok: false, error: 'SAME_DAY_NEEDS_TIMES' });
    expect(validateBookingDraft(car({ carPickupTime: undefined, carReturnTime: undefined })))
      .toMatchObject({ ok: false, error: 'SAME_DAY_NEEDS_TIMES' });
    expect(validateBookingDraft(car({ start: '2026-08-03', end: '2026-08-01' })))
      .toMatchObject({ ok: false, error: 'RETURN_BEFORE_PICKUP' });
  });

  it('숙박은 당일 체크아웃을 거부한다 (체크아웃 규칙을 렌터카에 쓰지 않는다 — 그 역도 마찬가지)', () => {
    expect(validateBookingDraft(hotel()).ok).toBe(true);
    expect(validateBookingDraft(hotel({ end: '2026-08-01' })))
      .toMatchObject({ ok: false, error: 'CHECKOUT_NOT_AFTER_CHECKIN' });
    expect(validateBookingDraft(hotel({ start: undefined, end: undefined })))
      .toMatchObject({ ok: false, error: 'TRACK_NEEDS_DATES' });
    expect(validateBookingDraft(hotel({ start: undefined, end: undefined, track: false })).ok).toBe(true);
  });

  it('이름·가격 필수', () => {
    expect(validateBookingDraft(hotel({ title: ' ' }))).toMatchObject({ ok: false, error: 'TITLE_REQUIRED' });
    expect(validateBookingDraft(hotel({ price: 0 }))).toMatchObject({ ok: false, error: 'PRICE_REQUIRED' });
  });
});

const trip = (): Trip => ({
  id: 't1', name: 'T', start: '2026-08-01',
  days: [{
    title: 'D1', drive: '', note: '', mode: 'car',
    spots: [
      { name: '공항', city: 'P', desc: '', lat: 39.55, lng: 2.73, carPickupId: 'bc' },
      { name: '호텔', city: 'P', desc: '', lat: 39.56, lng: 2.74, bookingId: 'bh', carReturnId: 'bc' }
    ]
  }],
  bookings: [hotel(), car()]
});

describe('deleteBooking — 골든: 참조를 깨끗이 정리한다', () => {
  it('carPickupId·carReturnId를 정리하고 다른 예약 연결은 보존', () => {
    const next = deleteBooking(trip(), 'bc');
    expect(next.bookings?.map(b => b.id)).toEqual(['bh']);
    expect(next.days[0].spots.some(s => s.carPickupId || s.carReturnId)).toBe(false);
    expect(next.days[0].spots[1].bookingId).toBe('bh');
  });
  it('마지막 예약을 지우면 bookings 키 자체를 제거 (공유 링크 크기 — 레거시 규칙)', () => {
    const next = deleteBooking(deleteBooking(trip(), 'bc'), 'bh');
    expect('bookings' in next).toBe(false);
    expect(next.days[0].spots.some(s => s.bookingId)).toBe(false);
  });
  it('원본 trip은 불변', () => {
    const t = trip();
    deleteBooking(t, 'bc');
    expect(t.bookings?.length).toBe(2);
    expect(t.days[0].spots[0].carPickupId).toBe('bc');
  });
});

describe('upsertBooking — normalizeBooking을 통과해 저장된다', () => {
  it('추가·수정 모두 정규화 거침 (불량 항목은 무시)', () => {
    const t = trip();
    const added = upsertBooking(t, hotel({ id: 'b2', title: '  New  ', price: 50000 }));
    expect(added.bookings?.length).toBe(3);
    expect(added.bookings?.find(b => b.id === 'b2')?.title).toBe('New');
    const edited = upsertBooking(added, hotel({ id: 'b2', title: 'Renamed', price: 60000 }));
    expect(edited.bookings?.length).toBe(3);
    expect(edited.bookings?.find(b => b.id === 'b2')?.price).toBe(60000);
    // 불량 id → 정규화가 거부 → 원본 유지
    expect(upsertBooking(t, hotel({ id: 'bad id!' })).bookings?.length).toBe(2);
  });
});
