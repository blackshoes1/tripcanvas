import { expect, it } from 'vitest';

import { buildBookings } from './bookingsView';
import type { TripDoc } from './todayView';

it('숙박·항공·차량과 일정의 기차·식당·공연 예약을 날짜와 시각 순으로 합친다', () => {
  const trip = {
    start: '2026-10-31', bookings: [
      { id: 'hotel', type: 'hotel', title: '호텔', start: '2026-11-01' },
      { id: 'car', type: 'car', title: '렌터카', start: '2026-11-02' },
      { id: 'flight', type: 'flight', title: '항공', start: '2026-10-30' }
    ], days: [{ spots: [
      { name: '저녁 식당', cat: 'food', bookAt: '19:00', cost: 25, cur: 'EUR', costBasis: 'PER_PERSON', costPeople: 2,
        desc: '창가 좌석', bookUrl: 'https://example.com/dinner', confirmation: 'R123' },
      { name: '기차', costKind: 'TRANSIT', bookAt: '09:00' },
      { name: '호텔 연결', bookingId: 'hotel', bookAt: '15:00' },
      { name: '방문 예정', at: '10:00' }
    ] }, { spots: [{ name: '공연', bookAt: '20:00', costKind: 'TICKET', cost: 0 }] }],
    costItems: [{ id: 'tour', title: '투어', kind: 'TICKET', payState: 'RESERVED', amount: 100 }]
  };
  const rows = buildBookings(trip, [], '2026-09-25');
  expect(rows.map(r => r.title)).toEqual(['항공', '기차', '저녁 식당', '공연', '호텔', '렌터카', '투어']);
  expect(rows.find(r => r.title === '기차')).toMatchObject({ type: 'transit', start: '2026-10-31', startTime: '09:00', priceKnown: false, source: 'SPOT', dayIndex: 0 });
  expect(rows.find(r => r.title === '저녁 식당')).toMatchObject({ type: 'restaurant', price: 50, currency: 'EUR', confirmation: 'R123', note: '창가 좌석', url: 'https://example.com/dinner', priceStatus: null });
  expect(rows.find(r => r.title === '공연')).toMatchObject({ start: '2026-11-01', price: 0, priceKnown: true });
  expect(rows.find(r => r.title === '투어')).toMatchObject({ source: 'TRIP_COST', start: null });
  expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
});

it('여행 시작일이 없어도 예약과 동일한 이름의 별도 예약을 숨기지 않는다', () => {
  const trip = { days: [{ spots: [{ name: '식당', bookUrl: 'https://example.com' }, { name: '식당', bookAt: '18:00' }],
    costItems: [{ id: 'bus', title: '버스', payState: 'RESERVED' }] }] };
  const rows = buildBookings(trip as TripDoc, [], '2026-09-25');
  expect(rows).toHaveLength(3);
  expect(rows.every(r => r.start === null)).toBe(true);
  expect(rows.find(r => r.title === '버스')?.source).toBe('DAY_COST');
  expect(new Set(rows.map(r => r.id)).size).toBe(3);
});

it('시각 없는 명소 예약 완료와 예약 메모도 반환한다', () => {
  const trip = { days: [{ spots: [{ name: '궁전', desc: '오후 방문', admission: {
    source: 'USER', personalStatus: 'BOOKED', note: '예약번호 ABC, 입구에서 QR 제시'
  } }] }] };
  expect(buildBookings(trip, [], '2026-09-25')[0]).toMatchObject({
    title: '궁전', startTime: null, note: '오후 방문\n예약번호 ABC, 입구에서 QR 제시', priceKnown: false
  });
});
