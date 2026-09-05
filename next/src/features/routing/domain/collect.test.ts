// collectLegRequests — 레거시 requestLeg 호출 집합의 재현을 고정한다:
// 이월 앵커→첫 장소 · 연속 쌍 · 숙소 복귀 · 대중교통 시각별 키(미래만) · 좌표 없는 장소 건너뜀.
import legacyLib from '@legacy/lib.js';
import { describe, expect, it } from 'vitest';

import type { Day, Spot, Trip } from '@/features/trip/domain/types';
import { collectLegRequests } from './collect';

const { legKey, parseHM, zonedMinutesToISOString } = legacyLib;

const spot = (name: string, lat: number | null, lng: number | null, extra: Partial<Spot> = {}): Spot =>
  ({ name, city: '제주', desc: '', lat, lng, ...extra });
const day = (spots: Spot[], extra: Partial<Day> = {}): Day =>
  ({ title: '', drive: '', note: '', mode: 'car', spots, ...extra });
const ll = (s: Spot): { lat: number; lng: number } => ({ lat: s.lat!, lng: s.lng! });
const trip = (days: Day[], extra: Partial<Trip> = {}): Trip =>
  ({ id: 't1', name: '테스트', start: '2100-01-01', days, ...extra });   // 먼 미래 — 대중교통 시각 키 검증용

const airport = () => spot('제주공항', 33.5104, 126.4914);
const seongsan = () => spot('성산일출봉', 33.4587, 126.9425);
const hotel = (extra: Partial<Spot> = {}) => spot('제주호텔', 33.4996, 126.5312, { stay: true, ...extra });
const NOW = Date.UTC(2026, 0, 1);

describe('collectLegRequests', () => {
  it('연속 쌍 + 숙소 복귀 + 이월 앵커→첫 장소, 좌표 없는 장소는 건너뛴다', () => {
    const t = trip([
      day([airport(), spot('미정', null, null), hotel()]),
      day([seongsan()]),
      day([])                                  // 마지막 날에는 복귀가 없다
    ]);
    const reqs = collectLegRequests(t, {}, NOW);
    const bases = reqs.map(r => r.base);
    expect(bases).toContain(legKey(ll(airport()), ll(hotel()), 'car'));      // 미정 건너뛴 연속 쌍
    expect(bases).toContain(legKey(ll(hotel()), ll(seongsan()), 'car'));     // 이월 앵커 → 2일차 첫 장소
    expect(bases).toContain(legKey(ll(seongsan()), ll(hotel()), 'car'));     // 2일차 숙소 복귀
    expect(reqs).toHaveLength(3);
    expect(reqs.every(r => r.when === null)).toBe(true);             // 자차 — 시각 키 없음
  });

  it('대중교통 미래 출발은 시각별 키(base@tz@when), 과거·시간대 없음은 base 키', () => {
    const seoulDay = day([airport(), seongsan()], { mode: 'transit', startAt: '10:00', timeZone: 'Asia/Seoul' });
    const future = collectLegRequests(trip([seoulDay]), {}, NOW);
    // si=1로 들어가는 구간의 출발 = 첫 장소 도착(시작시각 10:00) + 기본 체류 60분 = 11:00
    const expectWhen = zonedMinutesToISOString('2100-01-01', parseHM('10:00') + 60, 'Asia/Seoul');
    expect(future[0].when).toBe(expectWhen);
    expect(future[0].key).toBe(`${future[0].base}@Asia/Seoul@${expectWhen}`);

    const past = collectLegRequests(trip([seoulDay], { start: '2020-01-01' }), {}, NOW);
    expect(past[0].when).toBeNull();
    expect(past[0].key).toBe(past[0].base);
  });

  it('출발시각은 직전 장소 도착+대기+체류 — 캐시가 채워지면 시각 키가 갱신된다(재수집 수렴)', () => {
    const t = trip([day([airport(), seongsan()], { mode: 'transit', startAt: '09:00', timeZone: 'Asia/Seoul' })]);
    const a = airport(), b = seongsan();
    const cached = { [legKey(ll(a), ll(b), 'transit')]: { sec: 3600, m: 40000 } };
    const [req] = collectLegRequests(t, cached, NOW);
    // 첫 구간(도착 장소=b) 출발은 a의 체류가 아니라 시작시각 — si=1이므로 a 도착(09:00)+체류 60분
    expect(req.when).toBe(zonedMinutesToISOString('2100-01-01', 10 * 60, 'Asia/Seoul'));
  });

  it('같은 구간은 한 번만 (중복 키 제거)', () => {
    const t = trip([day([airport(), seongsan()]), day([airport(), seongsan()], { startPolicy: 'none' })]);
    const reqs = collectLegRequests(t, {}, NOW);
    expect(reqs.filter(r => r.base === legKey(ll(airport()), ll(seongsan()), 'car'))).toHaveLength(1);
  });
});
