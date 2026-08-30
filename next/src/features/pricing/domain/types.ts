// Pricing 도메인 모델 (§8·§30·§31) — 가격 관련 개념을 한 곳에 정의한다.
// 핵심 원칙: 확정(confirmed)·잠재(potential)·실제(actual/saved) 절약을 절대 섞지 않는다.
// 계산의 단일 출처는 레거시 price.js 순수 엔진 — engine.ts가 타입을 입혀 노출한다.

import type { Booking } from '@/features/booking/domain/types';
import type { CurrencyCode } from '@/features/trip/domain/types';

/** 조건 매칭 등급 — '같은 상품인가'. 검증 여부와 별개의 축 (P0-3) */
export type MatchQuality = 'EXACT' | 'EQUIVALENT' | 'SIMILAR' | 'UNMATCHED'
  /** 비교 기준(객실 수 등)이 예약과 달라 절약 판단에서 제외 — 참고 표시 전용 (P0-1) */
  | 'UNSUPPORTED_BASIS';

/** 검증 상태 — '판매처가 확인해 준 값인가'. 매칭 등급과 별개의 축 (P0-3) */
export type VerificationStatus = 'VERIFIED' | 'METASEARCH_ONLY' | 'UNKNOWN';

/** Provider 상태 (P0-2) — CONNECTED는 실제 구현 + 호출 성공이 있어야 한다 */
export type ProviderStatus = 'UNCONFIGURED' | 'AUTH_REQUIRED' | 'CREDENTIAL_READY' | 'CONNECTED' | 'ERROR';

/** 예약 추적 상태 — 카드 배지·상세 헤더·요약이 공유하는 단일 판정 */
export type TrackingState = 'SAVING_AVAILABLE' | 'CHEAPER_UNVERIFIED' | 'GOOD_PRICE' | 'WATCHING' | 'ERROR';

export type ObservationType = 'AUTOMATIC' | 'MANUAL';

/** 시세 응답의 비교 기준 — requestedRooms !== rooms면 확정·잠재 금지 (P0-1) */
export interface OfferBasis {
  rooms: number;
  adults?: number;
  requestedRooms?: number;
}

/** 하루 1점 가격 관측 */
export interface PriceObservation {
  price: number;
  cur?: CurrencyCode;
  seller?: string;
  quality?: MatchQuality;
  verified?: boolean;
  /** 수동 관측 표시 (recordCarManualPrice 등) */
  manual?: 1;
  /** ISO 시각 */
  at?: string;
}

/** 정규화된 시장 오퍼 — 호텔·렌터카 공용 필드 + 종별 조건 */
export interface MarketOffer {
  seller: string;
  /** 1박가 또는 총액 (total 없을 때) */
  price: number;
  /** 기간 총액 — 실효가 비교는 total 우선 (offerPrice) */
  total?: number;
  cur?: CurrencyCode;
  link?: string;
  quality?: MatchQuality;
  verified?: boolean;
  verifiedBy?: string;
  manual?: 1;
  // 호텔 조건
  roomName?: string;
  refundable?: boolean;
  breakfast?: boolean;
  // 렌터카 조건
  vehicleName?: string;
  vehicleClass?: string;
  transmission?: string;
  mileage?: string;
  insurance?: string;
  deposit?: number;
  pickupCode?: string;
  returnCode?: string;
}

/** 예약별 추적 레코드 — 로컬(tripcanvas_prices_v1) + 클라우드 스냅샷 병합 결과 */
export interface PriceRecord {
  obs: PriceObservation[];
  offers: MarketOffer[];
  /** 마지막 성공 조회 시각 (실패해도 기존 관측은 보존) */
  at: string | null;
  err: { code: string; at: string; detail?: string } | null;
  /** 마지막 성공 조회의 비교 기준 (P0-1) */
  basis?: OfferBasis | null;
  candidates?: { name: string; token: string }[];
  alert?: { price: number; at: string };
}

export interface ConfirmedSaving {
  offer: MarketOffer;
  /** 실질 절약 = 예약가 − 실효가 − 취소 수수료 */
  saving: number;
  rate: number;
}

export interface PotentialSaving {
  offer: MarketOffer;
  /** 최대 차액 — 수수료 미반영, 단정 금지 */
  delta: number;
}

/** Saving Decision — 확정과 잠재를 절대 섞지 않는다 */
export interface SavingDecision {
  confirmed: ConfirmedSaving | null;
  potential: PotentialSaving | null;
  fee: number;
}

export interface TrackState extends SavingDecision {
  state: TrackingState;
  at: string | null;
  err: PriceRecord['err'];
  /** 비교 기준 불일치 — UI가 '1객실 기준만 확인 가능'을 설명할 근거 (P0-1) */
  basisLimited: boolean;
}

/** 여행 단위 요약(₩ 환산) — booked·confirmed·potential·actual을 분리 합산 (§31) */
export interface TripSavingSummary {
  booked: number;
  confirmed: number;
  potential: number;
  actual: number;
  count: number;
}

export interface PriceCfg {
  minSaving: number;
  minRate: number;
  goodMargin: number;
  goodMinObs: number;
  staleHours: number;
  cooldownMin: number;
  errBackoffMin: number;
  staleNoticeHours: number;
  maxObs: number;
}

/** Discovery Provider 계약 (§32) — Provider가 없어도 core는 정상 동작해야 한다 */
export interface DiscoveryProvider<TRequest, TOffer> {
  id: string;
  supports(booking: Booking): boolean;
  health?(): Promise<{ id: string; role: string; status: ProviderStatus }[]>;
  search(request: TRequest): Promise<{ offers: TOffer[]; basis?: OfferBasis }>;
}
