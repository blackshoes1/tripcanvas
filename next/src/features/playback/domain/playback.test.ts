// 재생 경로·페이싱 검증 — 레거시 animPath/phases/seek 판정을 그대로 지키는지.
// 카메라·rAF 없이 순수 계산만 본다.
import legacyLib from '@legacy/lib.js';
import { describe, expect, it } from 'vitest';

import type { LegCache } from '@/features/itinerary/domain/types';
import type { Day, Spot, Trip } from '@/features/trip/domain/types';
import { buildAnimPath, isInterCity, PLAY_ZOOM_IN, PLAY_ZOOM_OUT } from './animPath';
import { buildTimeline, facesEast, legIndexAt, MIN_ANIM_POINTS, positionAt, seekTarget } from './timeline';

const spot = (name: string, lat: number, lng: number, extra: Partial<Spot> = {}): Spot =>
  ({ name, city: '제주', desc: '', lat, lng, ...extra });
const day = (spots: Spot[], extra: Partial<Day> = {}): Day =>
  ({ title: '', drive: '', note: '', mode: 'car', spots, ...extra });
const trip = (days: Day[]): Trip => ({ id: 't1', name: 'T', start: '2026-10-01', days });

const NONE: LegCache = {};
// 제주 실좌표 — 공항→성산 약 42km, 공항→시내 호텔 약 4km
const airport = () => spot('제주공항', 33.5104, 126.4914);
const hotel = () => spot('제주호텔', 33.4996, 126.5312, { stay: true });
const seongsan = () => spot('성산일출봉', 33.4587, 126.9425, { city: '서귀포' });

describe('isInterCity — 이름만으로 판단하지 않는다', () => {
  it('도시 이름이 다르고 충분히 멀면 도시 간', () => {
    expect(isInterCity(airport() as never, seongsan() as never)).toBe(true);
  });

  it('이름이 달라도 가까우면 도시 내 — 인근 명소에서 줌아웃이 남발되지 않게', () => {
    const near = spot('가까운명소', 33.5100, 126.4950, { city: '서귀포' });   // 이름만 다르고 300m
    expect(isInterCity(airport() as never, near as never)).toBe(false);
  });

  it('같은 도시면 멀어도 도시 내', () => {
    expect(isInterCity(airport() as never, spot('먼곳', 33.20, 126.90) as never)).toBe(false);
  });

  it('도시를 모르면 거리로만 (25km 기준)', () => {
    const a = spot('A', 33.5104, 126.4914, { city: '' });
    const b = spot('B', 33.4587, 126.9425, { city: '' });
    expect(isInterCity(a as never, b as never)).toBe(true);
    const c = spot('C', 33.4996, 126.5312, { city: '' });
    expect(isInterCity(a as never, c as never)).toBe(false);
  });
});

describe('buildAnimPath — 무엇을 재생하는가', () => {
  it('일자 필터 중이면 그 일자만 재생한다', () => {
    const t = trip([day([airport(), hotel()]), day([seongsan(), spot('X', 33.3, 126.5)])]);
    const all = buildAnimPath(t, NONE, 0);
    const d2 = buildAnimPath(t, NONE, 2);
    expect(new Set(all.map(p => p.di))).toEqual(new Set([0, 1]));
    expect(new Set(d2.map(p => p.di))).toEqual(new Set([1]));
  });

  it('캐시가 없으면 두 점을 잇는 직선', () => {
    const flat = buildAnimPath(trip([day([airport(), hotel()])]), NONE, 0);
    expect(flat).toHaveLength(2);
    expect(flat[0]).toMatchObject({ lat: 33.5104, from: '제주공항', to: '제주호텔', sec: null });
  });

  it('실경로가 캐시에 있으면 폴리라인을 따라간다', () => {
    const a = airport(), b = hotel();
    const path = legacyLib.encodePolyline([
      { lat: a.lat!, lng: a.lng! }, { lat: 33.505, lng: 126.51 }, { lat: b.lat!, lng: b.lng! }
    ]);
    const cache: LegCache = { [legacyLib.legKey(a as never, b as never, 'car')]: { sec: 600, m: 4200, path } };
    const flat = buildAnimPath(trip([day([a, b])]), cache, 0);
    expect(flat.length).toBe(3);
    expect(flat.every(p => p.sec === 600)).toBe(true);
  });

  it('도시 간 구간은 줌아웃, 도시 내는 줌인', () => {
    const inner = buildAnimPath(trip([day([airport(), hotel()])]), NONE, 0);
    expect(inner.every(p => p.zoom === PLAY_ZOOM_IN)).toBe(true);
    const outer = buildAnimPath(trip([day([airport(), seongsan()])]), NONE, 0);
    expect(outer.every(p => p.zoom === PLAY_ZOOM_OUT)).toBe(true);
  });

  it('전날 숙소에서 오늘 첫 장소로 이어 붙인다 (이월 앵커)', () => {
    const t = trip([day([hotel()]), day([seongsan()])]);
    const flat = buildAnimPath(t, NONE, 0);
    // Day2 재생은 숙소 → 성산으로 시작한다
    expect(flat.find(p => p.di === 1)).toMatchObject({ from: '제주호텔', to: '성산일출봉' });
  });

  it("startPolicy가 'none'이면 이월하지 않는다 (공항 이동일·야간열차)", () => {
    const t = trip([day([hotel()]), day([seongsan()], { startPolicy: 'none' })]);
    const flat = buildAnimPath(t, NONE, 0);
    expect(flat.some(p => p.di === 1)).toBe(false);   // 장소가 하나뿐이고 이월도 없으니 그릴 구간이 없다
  });

  it('좌표 없는 장소와 빈 일자는 건너뛴다', () => {
    const noLoc: Spot = { name: '미정', city: '제주', desc: '', lat: null, lng: null };
    const t = trip([day([airport(), noLoc, hotel()]), day([])]);
    const flat = buildAnimPath(t, NONE, 0);
    expect(flat.every(p => p.from !== '미정' && p.to !== '미정')).toBe(true);
    expect(flat.some(p => p.di === 1)).toBe(false);
  });

  it('구간별 수단은 도착 장소 기준이다', () => {
    const t = trip([day([airport(), hotel(), spot('걸어서', 33.4990, 126.5320, { legMode: 'walk' })], { mode: 'car' })]);
    const flat = buildAnimPath(t, NONE, 0);
    expect(flat.find(p => p.to === '걸어서')!.mode).toBe('walk');
    expect(flat.find(p => p.to === '제주호텔')!.mode).toBe('car');
  });
});

describe('buildTimeline — 카메라 고정 구간과 페이싱', () => {
  const longPath = () => buildAnimPath(
    trip([day([airport(), hotel(), seongsan()])]), NONE, 0
  );

  it('줌이 바뀌는 지점에서 구간을 자른다', () => {
    const { phases } = buildTimeline(longPath());
    expect(phases.length).toBe(2);                        // 도시 내(공항→호텔) → 도시 간(호텔→성산)
    expect(phases[0].zoom).toBe(PLAY_ZOOM_IN);
    expect(phases[1].zoom).toBe(PLAY_ZOOM_OUT);
  });

  it('구간은 누적거리를 빈틈없이 덮는다', () => {
    const { phases, gtotal } = buildTimeline(longPath());
    expect(phases[0].a).toBe(0);
    expect(phases[phases.length - 1].b).toBeCloseTo(gtotal, 6);
    for (let i = 1; i < phases.length; i++) expect(phases[i].a).toBeCloseTo(phases[i - 1].b, 6);
  });

  it('구간 소요는 2.5~9초로 묶인다 — 점 수·재생 범위와 무관하게 체감 속도 일정', () => {
    const { phases } = buildTimeline(longPath());
    phases.forEach(p => {
      expect(p.dur).toBeGreaterThanOrEqual(2500);
      expect(p.dur).toBeLessThanOrEqual(9000);
    });
  });

  it('구간 수는 장소 수가 아니라 legStarts로 센다', () => {
    const { legStarts } = buildTimeline(longPath());
    expect(legStarts.length).toBe(2);                     // 공항→호텔, 호텔→성산
    expect(legStarts[0]).toBe(0);
  });

  it('재생할 동선이 없으면 빈 타임라인 — 껍데기 구간을 만들지 않는다', () => {
    const flat = buildAnimPath(trip([day([airport()])]), NONE, 0);
    expect(flat.length).toBeLessThan(MIN_ANIM_POINTS);   // 호출측이 이걸로 먼저 막는다
    const { phases, gtotal } = buildTimeline(flat);
    expect(phases).toHaveLength(0);
    expect(gtotal).toBe(1);      // 0 나눗셈 방지 기본값
  });
});

describe('seekTarget / legIndexAt — 탐색', () => {
  const tl = () => buildTimeline(buildAnimPath(trip([day([airport(), hotel(), seongsan()])]), NONE, 0));

  it('진행률 0·1은 처음·끝 구간을 가리킨다', () => {
    const { phases, gtotal } = tl();
    expect(seekTarget(phases, gtotal, 0).pIdx).toBe(0);
    expect(seekTarget(phases, gtotal, 1).pIdx).toBe(phases.length - 1);
  });

  it('범위 밖 진행률은 잘라낸다', () => {
    const { phases, gtotal } = tl();
    expect(seekTarget(phases, gtotal, -5).d).toBe(0);
    expect(seekTarget(phases, gtotal, 9).d).toBeCloseTo(gtotal, 6);
  });

  it('구간 내 경과 시간은 그 구간 안에서의 비율이다', () => {
    const { phases, gtotal } = tl();
    const mid = (phases[0].a + phases[0].b) / 2;
    const r = seekTarget(phases, gtotal, mid / gtotal);
    expect(r.pIdx).toBe(0);
    expect(r.elapsed).toBeCloseTo(phases[0].dur / 2, 0);
  });

  it('legIndexAt — 누적거리로 몇 번째 구간인지', () => {
    const { legStarts, gtotal } = tl();
    expect(legIndexAt(legStarts, 0)).toBe(0);
    expect(legIndexAt(legStarts, gtotal)).toBe(legStarts.length - 1);
    expect(legIndexAt(legStarts, legStarts[1] - 0.001)).toBe(0);
    expect(legIndexAt(legStarts, legStarts[1])).toBe(1);
  });
});

describe('positionAt — 위치 보간', () => {
  const flat = () => buildAnimPath(trip([day([airport(), hotel(), seongsan()])]), NONE, 0);

  it('시작·끝은 첫 점·마지막 점', () => {
    const f = flat(), { gcum, gtotal } = buildTimeline(f);
    expect(positionAt(f, gcum, 0)).toMatchObject({ lat: f[0].lat, lng: f[0].lng });
    const end = positionAt(f, gcum, gtotal)!;
    expect(end.lat).toBeCloseTo(f[f.length - 1].lat, 6);
  });

  it('중간에서는 두 점 사이를 선형 보간한다', () => {
    const f = flat(), { gcum } = buildTimeline(f);
    const half = positionAt(f, gcum, gcum[1] / 2)!;
    expect(half.lat).toBeCloseTo((f[0].lat + f[1].lat) / 2, 6);
    expect(half.segIndex).toBe(0);
    expect(half.at.to).toBe('제주호텔');   // HUD가 쓸 구간 메타를 들고 있다
  });

  it('뒤로 탐색해도 올바른 구간을 찾는다 (앞으로만 훑지 않는다)', () => {
    const f = flat(), { gcum, gtotal } = buildTimeline(f);
    const forward = positionAt(f, gcum, gtotal)!;
    const back = positionAt(f, gcum, 0, forward.segIndex)!;   // 커서를 끝에 둔 채 처음으로
    expect(back.segIndex).toBe(0);
    expect(back.lat).toBeCloseTo(f[0].lat, 6);
  });

  it('점이 모자라면 null', () => {
    expect(positionAt([], [], 0)).toBe(null);
  });
});

describe('facesEast — 자동차 방향', () => {
  it('동쪽으로 가면 동쪽, 서쪽으로 가면 서쪽', () => {
    expect(facesEast({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, false)).toBe(true);
    expect(facesEast({ lat: 0, lng: 1 }, { lat: 0, lng: 0 }, true)).toBe(false);
  });

  it('순수 남북 이동이면 직전 방향을 유지한다 (깜빡 뒤집힘 방지)', () => {
    expect(facesEast({ lat: 0, lng: 5 }, { lat: 1, lng: 5 }, true)).toBe(true);
    expect(facesEast({ lat: 0, lng: 5 }, { lat: 1, lng: 5 }, false)).toBe(false);
  });
});
