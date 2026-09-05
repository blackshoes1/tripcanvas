// buildMapScene 배선 검증 — 레거시 render() 지도 규칙의 재현을 고정한다:
// 전부-국내일 때만 카카오 · 미캐시(조회 중) 구간은 선 없음 · 실경로 우선/실패만 직선 ·
// 경로선은 항상 일자 색 · 숙소 복귀 점선+👻🏠 · 일자 간 점선은 전체 보기·캐시 시에만 · 프레이밍 수치.
import legacyLib from '@legacy/lib.js';
import { describe, expect, it } from 'vitest';

import type { LegCache } from '@/features/itinerary/domain/types';
import type { Day, Spot, Trip } from '@/features/trip/domain/types';
import { PALETTE, buildMapScene, dayColor, desiredEngineOf, entryFitOf, fitTargetOf } from './scene';

const { encodePolyline, legKey } = legacyLib;

const spot = (name: string, lat: number | null, lng: number | null, extra: Partial<Spot> = {}): Spot =>
  ({ name, city: '제주', desc: '', lat, lng, ...extra });
const day = (spots: Spot[], extra: Partial<Day> = {}): Day =>
  ({ title: '', drive: '', note: '', mode: 'car', spots, ...extra });
const trip = (days: Day[], extra: Partial<Trip> = {}): Trip =>
  ({ id: 't1', name: '테스트 여행', start: '2026-10-01', days, ...extra });

const airport = () => spot('제주공항', 33.5104, 126.4914, { cat: 'transport' });
const seongsan = () => spot('성산일출봉', 33.4587, 126.9425);
const hotel = (extra: Partial<Spot> = {}) => spot('제주호텔', 33.4996, 126.5312, { stay: true, ...extra });
const osaka = () => spot('오사카성', 34.6873, 135.5262, { city: '오사카' });

const K = (a: Spot, b: Spot, mode = 'car') =>
  legKey({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! }, mode);
const NONE: LegCache = {};

describe('엔진 선택 — 보이는 범위가 전부 국내일 때만 카카오', () => {
  it('국내 전용=카카오, 해외 섞이면 구글, 일자 필터로 자동 전환', () => {
    const kr = trip([day([airport(), seongsan()])]);
    expect(desiredEngineOf(kr, 0)).toBe('kakao');

    const mixed = trip([day([airport()]), day([osaka()])]);
    expect(desiredEngineOf(mixed, 0)).toBe('google');   // 전체 보기: 해외 포함
    expect(desiredEngineOf(mixed, 1)).toBe('kakao');    // 1일차만: 국내
    expect(desiredEngineOf(mixed, 2)).toBe('google');   // 2일차만: 해외
    expect(buildMapScene(mixed, NONE, 1).engine).toBe('kakao');
  });

  it('좌표 스팟이 하나도 없으면 구글 (전 세계 기본)', () => {
    expect(desiredEngineOf(trip([day([spot('미정', null, null)])]), 0).toString()).toBe('google');
  });
});

describe('핀 — 순서 번호·색 모드·카테고리 배지', () => {
  it('좌표 미지정은 핀 생략, 번호는 그날 순서(si+1) 유지', () => {
    const t = trip([day([airport(), spot('미정', null, null), seongsan()])]);
    const { pins } = buildMapScene(t, NONE, 0);
    expect(pins.map(p => p.label)).toEqual([1, 3]);   // 미정(2번)은 카드에만 남는다
    expect(pins[0].catIcon).toBe('🚉');
    expect(pins[0].title).toBe('🚉 교통 · 제주공항');
  });

  it("기본은 일자 색, colorBy 'city'면 같은 도시가 같은 색 — 경로선은 항상 일자 색", () => {
    const a = airport(), b = seongsan();
    const cache: LegCache = { [K(a, b)]: { sec: 600, m: 8000 } };
    const byDay = buildMapScene(trip([day([a]), day([{ ...seongsan() }])]), NONE, 0);
    expect(byDay.pins[0].color).toBe(dayColor(0));
    expect(byDay.pins[1].color).toBe(dayColor(1));

    const byCity = buildMapScene(
      trip([day([airport()]), day([{ ...seongsan() }])], { colorBy: 'city' }), cache, 0);
    expect(byCity.pins[0].color).toBe(byCity.pins[1].color);   // 같은 도시(제주) = 같은 색
    expect(byCity.pins[0].color).toBe(PALETTE[0]);

    const cityLines = buildMapScene(trip([day([a, b])], { colorBy: 'city' }), cache, 0);
    expect(cityLines.lines[0].color).toBe(dayColor(0));        // 선은 색 모드와 무관
  });

  it('선택 코스는 opt 표시(작고 반투명한 핀)', () => {
    const { pins } = buildMapScene(trip([day([{ ...seongsan(), opt: true }])]), NONE, 0);
    expect(pins[0].opt).toBe(true);
  });
});

describe('동선 라인 — 실경로 우선, 조회 중엔 없음, 실패만 직선', () => {
  const a = airport(), b = seongsan();

  it('미캐시(조회 중) 구간은 선을 긋지 않는다 (직선→실경로 깜빡임 제거와 동일 규칙)', () => {
    expect(buildMapScene(trip([day([a, b])]), NONE, 0).lines).toHaveLength(0);
  });

  it('경로가 있으면 디코드된 실경로, 실패(경로 없음) 항목만 직선 2점', () => {
    const path = encodePolyline([
      { lat: a.lat!, lng: a.lng! }, { lat: 33.48, lng: 126.7 }, { lat: b.lat!, lng: b.lng! }
    ]);
    const withPath = buildMapScene(trip([day([a, b])]), { [K(a, b)]: { sec: 3600, m: 40000, path } }, 0);
    expect(withPath.lines[0].pts).toHaveLength(3);
    expect(withPath.lines[0].pts[1].lng).toBeCloseTo(126.7, 4);
    expect(withPath.lines[0].dashed).toBe(false);
    expect(withPath.lines[0].opacity).toBe(0.7);               // 전체 보기

    const failed = buildMapScene(trip([day([a, b])]), { [K(a, b)]: { fail: true } }, 0);
    expect(failed.lines[0].pts).toEqual([
      { lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }
    ]);
  });

  it('일자 보기(activeDay)는 진하게(0.9) + 경로 중간 소요시간 칩, 자차 2km 미만은 🚶', () => {
    const v = buildMapScene(trip([day([a, b])]), { [K(a, b)]: { sec: 3600, m: 40000 } }, 1);
    expect(v.lines[0].opacity).toBe(0.9);
    expect(v.chips).toHaveLength(1);
    expect(v.chips[0].text).toBe('🚗1시간');
    expect(v.chips[0].lat).toBeCloseTo((a.lat! + b.lat!) / 2, 6);   // 경로 없으면 두 점의 중간

    const walk = buildMapScene(trip([day([a, b])]), { [K(a, b)]: { sec: 600, m: 1500 } }, 1);
    expect(walk.chips[0].text).toBe('🚶20분');

    const all = buildMapScene(trip([day([a, b])]), { [K(a, b)]: { sec: 3600, m: 40000 } }, 0);
    expect(all.chips).toHaveLength(0);                         // 칩은 일자 보기 전용
  });
});

describe('숙소 복귀·일자 간 연결 — 자동 합성 구간은 점선', () => {
  it('숙소 복귀는 캐시된 경우에만 점선(0.85배 투명도)으로 붙는다', () => {
    const h = hotel(), b = seongsan();
    const t = trip([day([h, b]), day([])]);   // 마지막 날에는 복귀가 없다
    expect(buildMapScene(t, NONE, 0).lines).toHaveLength(0);   // 조회 중 — 없음
    const v = buildMapScene(t, { [K(b, h)]: { sec: 900, m: 9000 } }, 1);
    const back = v.lines.find(l => l.dashed)!;
    expect(back).toBeDefined();
    expect(back.opacity).toBeCloseTo(0.9 * 0.85, 6);
  });

  it('연박 이월 숙소(그날 목록에 없음)로 돌아가면 👻🏠 표식이 남는다', () => {
    const h = hotel({ nights: 2 });
    const t = trip([day([h]), day([seongsan()]), day([])]);
    const v = buildMapScene(t, NONE, 2);   // 2일차만 보기 — 복귀 대상이 전날 숙소
    expect(v.ghosts).toHaveLength(1);
    expect(v.ghosts[0].title).toBe('제주호텔');
    expect(v.ghosts[0].color).toBe(dayColor(1));

    const own = buildMapScene(trip([day([seongsan(), hotel()])]), NONE, 0);
    expect(own.ghosts).toHaveLength(0);    // 그날 목록에 있는 숙소면 핀이 이미 있다
  });

  it('일자 간 점선은 전체 보기·캐시된 경우에만, startPolicy none이면 없음', () => {
    const h = hotel(), b = seongsan();
    const key = K(h, b);
    const cached: LegCache = { [key]: { sec: 1800, m: 20000 } };
    const t = trip([day([airport(), h]), day([b])]);

    expect(buildMapScene(t, NONE, 0).lines.filter(l => l.dashed)).toHaveLength(0);   // 미캐시
    const inter = buildMapScene(t, cached, 0).lines.filter(l => l.dashed);
    expect(inter).toHaveLength(1);
    expect(inter[0].color).toBe(dayColor(1));                  // 도착 일자 색
    expect(inter[0].opacity).toBe(0.8);

    expect(buildMapScene(t, cached, 2).lines.filter(l => l.dashed)).toHaveLength(0); // 일자 보기: 없음

    const none = trip([day([airport(), h]), day([b], { startPolicy: 'none' })]);
    expect(buildMapScene(none, cached, 0).lines.filter(l => l.dashed)).toHaveLength(0);
  });
});

describe('카메라 프레이밍 — 레거시 fit 수치 그대로', () => {
  it('일자 보기 pad 64·maxZoom 15, 전체 보기 pad 60, 진입은 위치 있는 첫 일자', () => {
    const t = trip([day([]), day([airport(), seongsan()]), day([osaka()])]);
    expect(fitTargetOf(t, 2)).toEqual({ pts: [[33.5104, 126.4914], [33.4587, 126.9425]], pad: 64, maxZoom: 15 });
    const all = fitTargetOf(t, 0)!;
    expect(all.pts).toHaveLength(3);
    expect(all.pad).toBe(60);
    expect(all.maxZoom).toBeUndefined();
    expect(entryFitOf(t)).toEqual(fitTargetOf(t, 2));          // 첫 위치 일자 = Day 2
    expect(fitTargetOf(trip([day([spot('미정', null, null)])]), 0)).toBeNull();
    // 위치 일자를 필터했지만 그 일자에 좌표가 없으면 전체로 폴백
    expect(fitTargetOf(t, 1)!.pts).toHaveLength(3);
  });
});
