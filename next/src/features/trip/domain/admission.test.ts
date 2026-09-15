import { describe, expect, it } from 'vitest';
import lib from '@legacy/lib.js';

const trip = (admission: unknown) => ({
  name: '합성 여행', days: [{ spots: [{ name: '합성 명소', bookAt: '12:07', bookingId: 'hotel1', cost: 20, cur: 'EUR',
    admission, hours: [{ d: 1, o: 540, c: 1020 }], split: 'group1', custom: { keep: true } }] }]
});
const firstSpot = (value: unknown) => (value as { days: { spots: Record<string, unknown>[] }[] }).days[0].spots[0];

describe('사용자가 확인한 명소 예약 정보', () => {
  it('서버·웹 정규화 왕복에서 사용자 확인·예약 상태와 기존 숨은 필드를 보존한다', () => {
    const admission = { source: 'USER', requirement: 'REQUIRED', personalStatus: 'BOOKED',
      officialURL: 'https://example.org/tickets', checkedAt: '2026-09-16T00:30:00+09:00', people: 2, note: '성인 일반권' };
    const first = lib.validateTripPayload(trip(admission));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = lib.validateTripPayload(JSON.parse(JSON.stringify(first.value)));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(firstSpot(second.value)).toMatchObject({ admission, bookAt: '12:07', bookingId: 'hotel1',
      cost: 20, cur: 'EUR', hours: [{ d: 1, o: 540, c: 1020 }], split: 'group1', custom: { keep: true } });
  });

  it.each(['REQUIRED', 'RECOMMENDED', 'NOT_REQUIRED', 'UNKNOWN'])('%s 요건을 예약 완료나 비용으로 해석하지 않는다', requirement => {
    const result = lib.normalizeTrip(trip({ source: 'USER', requirement }));
    expect(firstSpot(result).admission).toEqual({ source: 'USER', requirement });
    expect(firstSpot(result).cost).toBe(20);
    expect(firstSpot(result).bookAt).toBe('12:07');
  });

  it('기존 예약 시각·숙박 ID만 있는 장소에 명소 예약 완료를 만들어 넣지 않는다', () => {
    const result = lib.normalizeTrip(trip(undefined));
    expect(firstSpot(result).admission).toBeUndefined();
  });

  it.each([
    { source: 'GOOGLE', requirement: 'REQUIRED' }, { source: 'USER', requirement: 'FREE' },
    { source: 'USER', personalStatus: true }, { source: 'USER', officialURL: 'javascript:alert(1)' },
    { source: 'USER', officialURL: 'http://example.org' }, { source: 'USER', officialURL: 'https://user:secret@example.org' },
    { source: 'USER', checkedAt: '2026-02-30T00:00:00Z' }, { source: 'USER', checkedAt: '2026-09-16' },
    { source: 'USER', people: 0 }, { source: 'USER', people: 1.5 }, { source: 'USER', people: '2' },
    { source: 'USER', note: 'x'.repeat(1001) }
  ])('서버 저장에서 잘못된 명소 예약 입력을 거절한다: %j', admission => {
    expect(lib.validateTripPayload(trip(admission)).ok).toBe(false);
  });

  it('외부 유입 정규화는 불량 값과 외부 가격을 버리고 확인 필요로 남긴다', () => {
    const result = lib.normalizeTrip(trip({ source: 'USER', requirement: 'FREE', personalStatus: 'AUTO',
      checkedAt: 'not-a-time', officialURL: 'javascript:alert(1)', people: false,
      quote: { amount: 0, currency: 'KRW' }, reservable: true }));
    expect(firstSpot(result).admission).toEqual({ source: 'USER', requirement: 'UNKNOWN' });
    expect(firstSpot(result).cost).toBe(20);
  });
});
