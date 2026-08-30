// Itinerary 뷰 모델 — buildDayView가 만드는 직렬화 가능한 표시 데이터.
// 배선(anchor/carry·타임라인·렌터카 연결·비용 배분)은 전부 domain에서 끝내고 컴포넌트는 그리기만 한다.

import type { TransportMode } from '@/features/trip/domain/types';

/** 레거시 구간 캐시(tripcanvas_legs_v4) 항목 — routing.js가 채우고 여기서는 읽기만 한다 */
export interface CachedLeg {
  /** 소요 초 (없으면 실패/조회중 항목) */
  sec?: number;
  /** 거리 m */
  m?: number;
  mode?: string;
  /** 인코딩 폴리라인 (지도용 — Phase 5) */
  path?: string;
  /** 예상 택시비(원) */
  taxi?: number;
  /** 직선/도로거리 기반 추정 여부 (비행기·기차 등) */
  est?: boolean;
  /** 인근 도로 스냅으로 보정된 경로 */
  snapped?: boolean;
  /** 인근 도로 탐색까지 실패 */
  fail?: boolean;
}
export type LegCache = Readonly<Record<string, CachedLeg>>;

/** 이 장소로 '들어오는' 구간 표시 (레거시 .spotLeg 동일 규칙) */
export interface LegView {
  mode: TransportMode;
  modeIcon: string;
  /** "↳1.2km · 🚶16분" / "↳12.4km · 25분" / 미캐시 "↳3.1km" */
  label: string;
  /** 출처 설명 (실제 도로 / 추정 / 직선) */
  title: string;
  cached: boolean;
  /** 경로 조회 실패(인근 도로 스냅까지) — 직선거리 + ⚠️ */
  failed: boolean;
}

/** 일정 장소 행에 붙는 렌터카 픽업·반납 칩 (spot.carPickupId·carReturnId 연결) */
export interface CarChipView {
  kind: 'pickup' | 'return';
  bookingId: string;
  /** "렌터카 픽업 10:00" */
  label: string;
  title: string;
}

/** 연결 안 된 렌터카 이벤트의 독립 행 (carEventsOn 파생 — 동선·ETA에 안 들어감) */
export interface CarEventRowView {
  kind: 'pickup' | 'return';
  bookingId: string;
  /** "제주공항 (CJU)" — 장소·코드 모두 없으면 라벨("렌터카 픽업")로 대체됨 */
  placeLabel: string;
  /** "렌터카 픽업 · 10:00" 류 메타 줄 */
  subLabel: string;
  title: string;
}

export interface SpotView {
  si: number;
  order: number;
  name: string;
  city: string;
  desc: string;
  catIcon: string | null;
  catName: string | null;
  /** "09:30" (natural 24h 초과분은 etaTitle에서 설명) */
  etaText: string;
  /** 📌 도착 고정(spot.at) */
  fixed: boolean;
  /** 고정 시각이 이동상 불가능 (기차·비행기 시간표 구간은 억제) */
  conflict: boolean;
  etaTitle: string;
  /** "🏠 숙소 · 2박" / "2박" — 없으면 null */
  stayLabel: string | null;
  optional: boolean;
  noLoc: boolean;
  cost: { label: string; converted: string | null; title: string | null } | null;
  book: { at: string; warn: boolean; title: string; waitMin: number } | null;
  bookUrl: string | null;
  carChips: CarChipView[];
  hoursWarn: string | null;
  /** 이전 위치 → 이 장소 구간 (첫 유효 장소는 이월 앵커에서 출발) */
  leg: LegView | null;
}

export interface DayCostPart {
  label: '장소' | '택시' | '예약';
  amount: number;
}

export interface DayView {
  di: number;
  dayNo: number;
  title: string;
  /** YYYY-MM-DD ('' = 여행 시작일 미지정) */
  iso: string;
  /** "10/2 (금)" */
  dateLabel: string;
  timeZone: string;
  mode: TransportMode;
  modeIcon: string;
  modeName: string;
  drive: string;
  note: string;
  /** "✈️ KE1234 · GMP 09:00 → CJU 10:10" */
  flightLabel: string | null;
  /** 🏠 전날 숙소 이월 항목 — 시작 앵커가 '숙소'일 때만 (표시 전용, ETA는 anchor 기준) */
  carry: { name: string; startAt: string } | null;
  /** carry가 아닐 때의 일자 간 이동 안내 ("이전 일정에서 12.4km · 25분") */
  interDayLabel: string | null;
  /** 연결 안 된 렌터카 픽업 — 장소 목록 앞 */
  carPickups: CarEventRowView[];
  spots: SpotView[];
  /** 연결 안 된 렌터카 반납 — 장소 목록 뒤(숙소 복귀 앞) */
  carReturns: CarEventRowView[];
  /** 숙소 복귀 자동 구간 */
  back: { name: string; modeIcon: string; leg: LegView } | null;
  /** "📏 하루 동선 약 12.4km · 🚗25분 (도로 기준)" */
  routeLabel: string | null;
  /** "⚠️ 일정 과밀 — 예상 종료 23:10" */
  overloadLabel: string | null;
  /** 하루 비용 (장소 + 택시 + 예약 하루치) — 0이면 parts가 빈다 */
  cost: { total: number; parts: DayCostPart[] };
}

/** 필터바 '전체 비용'과 같은 규칙 — 예약은 전액이라 하루치 합계보다 클 수 있다 */
export interface TripCostView {
  spots: number;
  taxi: number;
  hotel: number;
  car: number;
  flight: number;
  total: number;
}
