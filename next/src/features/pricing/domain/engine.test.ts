// Golden parity — TS 도메인 엔진이 레거시 price.js와 '같은 구현'을 쓰고, 타입 계약이
// 실제 반환 형태와 맞는지 고정한다. (레거시 상세 동작 자체는 test/price.test.js가 소유)
import { describe, expect, it } from 'vitest';

import type { HotelBooking } from '@/features/booking/domain/types';
import {
  decideSaving, getTrackingState, isSavingWorth, matchHotelOffer,
  offerPrice, qualityWithBasis, tripSavingSummary, verificationStatus
} from './engine';

const hotel: HotelBooking = {
  id: 'b1', type: 'hotel', title: 'Cap Rocat', price: 1350000, cur: 'KRW',
  refundable: true, track: true, start: '2026-10-30', end: '2026-11-01'
};

describe('pricing engine (legacy 단일 소스 래핑)', () => {
  it('확정(동일 조건)과 잠재(SIMILAR)를 섞지 않는다 (§31)', () => {
    const d = decideSaving(hotel, [
      { seller: 'Expedia', price: 1180000, refundable: true },
      { seller: 'Agoda', price: 1160000 }
    ], { today: '2026-08-30' });
    expect(d.confirmed?.offer).toMatchObject({ seller: 'Expedia' });
    expect(d.confirmed?.saving).toBe(170000);
    expect(d.potential?.offer).toMatchObject({ seller: 'Agoda' });
    expect(d.potential?.delta).toBe(190000);
  });

  it('P0-1: basis(객실 수) 불일치 → UNSUPPORTED_BASIS, 확정·잠재 모두 금지', () => {
    const two: HotelBooking = { ...hotel, rooms: 2, price: 1400000 };
    const q = qualityWithBasis(matchHotelOffer(two, { seller: 'E', price: 700000, refundable: true }), two, { rooms: 1 });
    expect(q).toBe('UNSUPPORTED_BASIS');
    const d = decideSaving(two, [{ seller: 'E', price: 700000, refundable: true, quality: q }], { today: '2026-08-30' });
    expect(d.confirmed).toBeNull();
    expect(d.potential).toBeNull();
  });

  it('P0-3: 매칭 축과 검증 축은 분리된다', () => {
    expect(verificationStatus({ seller: 'E', price: 1, verified: true })).toBe('VERIFIED');
    expect(verificationStatus({ seller: 'E', price: 1 })).toBe('METASEARCH_ONLY');
    expect(verificationStatus({ seller: 'E', price: 1, manual: 1 })).toBe('UNKNOWN');
  });

  it('getTrackingState — basisLimited 플래그와 상태를 함께 노출한다', () => {
    const two: HotelBooking = { ...hotel, rooms: 2, price: 1400000 };
    const st = getTrackingState(two, {
      obs: [{ price: 700000, at: '2026-08-30T09:00:00Z', quality: 'UNSUPPORTED_BASIS' }],
      offers: [{ seller: 'E', price: 700000, quality: 'UNSUPPORTED_BASIS' }],
      at: '2026-08-30T09:00:00Z', err: null, basis: { rooms: 1, requestedRooms: 2 }
    }, { today: '2026-08-30' });
    expect(st?.state).toBe('WATCHING');
    expect(st?.basisLimited).toBe(true);
  });

  it('tripSavingSummary — booked·confirmed·potential·actual 분리 합산', () => {
    const s = tripSavingSummary([{ ...hotel, saved: 30000 }], {
      b1: {
        obs: [], at: '2026-08-30T09:00:00Z', err: null,
        offers: [
          { seller: 'Expedia', price: 1180000, refundable: true, quality: 'EQUIVALENT' },
          { seller: 'Agoda', price: 1160000, quality: 'SIMILAR' }
        ]
      }
    }, { today: '2026-08-30' });
    expect(s).toMatchObject({ booked: 1350000, confirmed: 170000, potential: 190000, actual: 30000, count: 1 });
  });

  it('offerPrice — 총액 우선 · isSavingWorth 임계값', () => {
    expect(offerPrice({ seller: 'E', price: 100, total: 250 })).toBe(250);
    expect(isSavingWorth({ saving: 60000, rate: 0.04 })).toBe(true);
    expect(isSavingWorth({ saving: 30000, rate: 0.04 })).toBe(false);
  });
});
