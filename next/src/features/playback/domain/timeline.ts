// 재생 타임라인 — 점 목록을 '카메라 고정 구간(phase)'으로 잘라 페이싱을 정한다 (순수).
//
// 왜 구간을 자르나: 구간 진입 시 전체를 한 화면에 담고 타일 로딩을 끝낸 뒤, 이동 중엔 카메라를
// 전혀 움직이지 않는다 → 새 타일 로딩이 없어(자동차는 오버레이라 타일 무관) 네트워크와 무관하게
// 매끄럽게 미끄러진다. 자르는 기준은 줌이 바뀌는 지점(도시 내 ↔ 도시 간).
import legacyLib from '@legacy/lib.js';

import type { LatLng } from '@/features/itinerary/domain/dayView';
import { PLAY_ZOOM_IN, type AnimPoint } from './animPath';

const { haversine } = legacyLib;

export interface Phase {
  /** 구간이 차지하는 누적거리 [a, b] */
  a: number;
  b: number;
  zoom: number;
  pts: [number, number][];
  /** 재생 소요(ms) */
  dur: number;
}

export interface PlayTimeline {
  /** 각 점까지의 실거리 누적 — 위치 보간의 기준 */
  gcum: number[];
  gtotal: number;
  phases: Phase[];
  /** 구간(leg) 시작 누적거리 — 이전/다음 구간 이동·구간 수 표시 */
  legStarts: number[];
}

/** 재생에 필요한 최소 점 수 */
export const MIN_ANIM_POINTS = 2;

export function buildTimeline(flat: AnimPoint[]): PlayTimeline {
  // 재생할 동선이 없으면 빈 타임라인. 호출측(재생 시작)이 먼저 막지만, 여기서도 총체적으로 둔다 —
  // 방어하지 않으면 점 하나짜리 입력에 '아무 데도 아닌' 껍데기 구간이 생겨 카메라가 엉뚱하게 잡힌다.
  if (flat.length < MIN_ANIM_POINTS) return { gcum: [0], gtotal: 1, phases: [], legStarts: [0] };

  const gcum = [0];
  for (let i = 1; i < flat.length; i++) gcum[i] = gcum[i - 1] + haversine(flat[i - 1], flat[i]);
  const gtotal = gcum[gcum.length - 1] || 1;

  // 줌이 바뀌는 누적거리 '경계' → 구간 분할
  const bounds: { dist: number; zoom: number }[] = [];
  for (let i = 1; i < flat.length; i++) {
    const zi = flat[i].zoom || PLAY_ZOOM_IN, zp = flat[i - 1].zoom || PLAY_ZOOM_IN;
    if (zi !== zp) bounds.push({ dist: gcum[i], zoom: zi });
  }
  const cuts = [0, ...bounds.map(b => b.dist), gtotal];

  const phases: Phase[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k], b = cuts[k + 1];
    if (b - a < 1e-6) continue;
    const zoom = k === 0 ? (flat[0]?.zoom || PLAY_ZOOM_IN) : bounds[k - 1].zoom;

    const pts: [number, number][] = [];
    let mnLa = 90, mxLa = -90, mnLn = 180, mxLn = -180;
    for (let i = 0; i < flat.length; i++) {
      if (gcum[i] < a - 1e-6 || gcum[i] > b + 1e-6) continue;
      const p = flat[i];
      pts.push([p.lat, p.lng]);
      mnLa = Math.min(mnLa, p.lat); mxLa = Math.max(mxLa, p.lat);
      mnLn = Math.min(mnLn, p.lng); mxLn = Math.max(mxLn, p.lng);
    }
    if (!pts.length && flat[0]) {
      pts.push([flat[0].lat, flat[0].lng]);
      mnLa = mxLa = flat[0].lat; mnLn = mxLn = flat[0].lng;
    }

    // 화면 대각(구간이 화면을 채우는 정도) 대비 실제 경로 길이 → 직선이면 ~1, 굽이질수록↑.
    // dur을 '구간이 화면을 가로지르는 시간'으로 잡아, 점 수·재생 범위(일자/전체)와 무관하게
    // 체감 속도를 일정하게 만든다 (≈4.2초/화면).
    const span = Math.max(0.4, haversine({ lat: mnLa, lng: mnLn }, { lat: mxLa, lng: mxLn }));
    const dur = Math.min(9000, Math.max(2500, Math.max(1, (b - a) / span) * 4200));
    phases.push({ a, b, zoom, pts, dur });
  }

  const legStarts = [0];
  for (let i = 1; i < flat.length; i++) {
    if (flat[i].from !== flat[i - 1].from || flat[i].to !== flat[i - 1].to) legStarts.push(gcum[i]);
  }

  return { gcum, gtotal, phases, legStarts };
}

/** frac(0~1) → phase 인덱스·누적거리·구간 내 경과(ms) */
export function seekTarget(phases: Phase[], gtotal: number, frac: number): { pIdx: number; d: number; elapsed: number } {
  const d = Math.max(0, Math.min(1, frac)) * gtotal;
  let pIdx = 0;
  while (pIdx < phases.length - 1 && d > phases[pIdx].b + 1e-6) pIdx++;
  const ph = phases[pIdx];
  return { pIdx, d, elapsed: ph ? ((d - ph.a) / ((ph.b - ph.a) || 1)) * ph.dur : 0 };
}

/** 누적거리 d가 속한 구간(leg) 인덱스 */
export function legIndexAt(legStarts: number[], d: number): number {
  let i = 0;
  while (i < legStarts.length - 1 && d >= legStarts[i + 1] - 1e-6) i++;
  return i;
}

export interface PlayPosition extends LatLng {
  segIndex: number;
  /** 지금 지나는 구간의 시작 점 — HUD가 쓰는 메타(from/to/mode/sec/di)를 들고 있다 */
  at: AnimPoint;
  next: AnimPoint;
}

/** 누적거리 d에서의 위치 — 점 사이를 선형 보간한다 */
export function positionAt(flat: AnimPoint[], gcum: number[], d: number, fromSeg = 0): PlayPosition | null {
  if (flat.length < MIN_ANIM_POINTS) return null;
  let seg = Math.max(0, Math.min(fromSeg, flat.length - 2));
  while (seg < flat.length - 2 && gcum[seg + 1] < d) seg++;
  while (seg > 0 && gcum[seg] > d) seg--;              // 탐색으로 뒤로 갔을 때 보정
  const A = flat[seg], B = flat[seg + 1];
  const segLen = (gcum[seg + 1] - gcum[seg]) || 1;
  const f = (d - gcum[seg]) / segLen;
  return { lat: A.lat + (B.lat - A.lat) * f, lng: A.lng + (B.lng - A.lng) * f, segIndex: seg, at: A, next: B };
}

/**
 * 🚗는 측면뷰(수평 옆모습)라 회전시키면 눕거나 서 보인다. → 회전 없이 진행 방향의 동/서 성분으로
 * 좌우만 뒤집는다. 순수 남북 이동(동/서 성분 0)에선 방향이 애매하므로 직전 값을 유지한다(깜빡임 방지).
 */
export function facesEast(a: LatLng, b: LatLng, prev: boolean): boolean {
  const ex = b.lng - a.lng;
  return Math.abs(ex) > 1e-7 ? ex > 0 : prev;
}
