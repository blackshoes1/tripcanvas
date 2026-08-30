// Saving Engine — 순수 함수 (§9: 네트워크·DOM·React 무의존).
// 구현의 단일 출처는 저장소 루트 price.js(유닛 테스트 + tsc 대상)다. Strangler 이관 중에는
// 로직을 복제하지 않고 그대로 import해 타입만 입힌다 — 두 구현이 갈라지는 회귀를 원천 차단.
// 레거시 제거 단계(Phase 6)에서 이 파일이 구현 본체를 넘겨받는다.
import legacy from '@legacy/price.js';

import type { Booking, CarBooking, HotelBooking } from '@/features/booking/domain/types';
import type {
  MarketOffer, MatchQuality, OfferBasis, PriceCfg, PriceObservation, PriceRecord,
  SavingDecision, TrackState, TripSavingSummary, VerificationStatus
} from './types';

export interface EngineOpts {
  today?: string;
  krwRate?: number;
  cfg?: PriceCfg;
}

export const PRICE_CFG = legacy.PRICE_CFG as unknown as Readonly<PriceCfg>;

/** 지금 취소하면 내는 실질 수수료 — 무료취소 기한 안이면 0 */
export function cancelFeeNow(b: Booking, today?: string): number {
  return legacy.cancelFeeNow(b, today);
}

/** 실질 절약액·하락률 (예약 통화 기준) */
export function calcSaving(b: Booking, current: number, today?: string) {
  return legacy.calcSaving(b, current, today);
}

/** 의미 있는 절약 기회인지 — ₩ 환산 금액 또는 하락률 기준 */
export function isSavingWorth(sv: { saving: number; rate: number }, krwRate?: number, cfg?: PriceCfg): boolean {
  return legacy.savingWorth(sv, krwRate, cfg);
}

/** 오퍼 실효가 — 총액 우선, 없으면 1박가 */
export function offerPrice(o: MarketOffer): number {
  return legacy.offerPrice(o);
}

/** 호텔 조건 매칭 — '같은 상품인가' (검증 여부와 별개의 축) */
export function matchHotelOffer(b: HotelBooking, o: MarketOffer): MatchQuality {
  return legacy.matchQuality(b, o) as MatchQuality;
}

/** 렌터카 조건 매칭 — 차급·변속기·보험·주행거리 하락이면 확정 금지 */
export function matchCarOffer(b: CarBooking, o: MarketOffer): MatchQuality {
  return legacy.carMatchQuality(b, o) as MatchQuality;
}

/** P0-1: 비교 기준(객실 수) 불일치면 어떤 등급도 UNSUPPORTED_BASIS로 강등 */
export function qualityWithBasis(q: MatchQuality, b: Booking, basis: OfferBasis | null | undefined): MatchQuality {
  return legacy.qualityWithBasis(q, b, basis) as MatchQuality;
}

export function basisMismatch(b: Booking, basis: OfferBasis | null | undefined): boolean {
  return legacy.basisMismatch(b, basis);
}

/** P0-3: 검증 축 — 매칭 등급과 무관하게 '판매처가 확인한 값인가'만 답한다 */
export function verificationStatus(o: MarketOffer): VerificationStatus {
  return legacy.verificationStatus(o) as VerificationStatus;
}

/** Saving Decision — 확정(EXACT/EQUIVALENT)과 잠재(SIMILAR)를 절대 섞지 않는다 */
export function decideSaving(b: Booking, offers: MarketOffer[], opts?: { today?: string }): SavingDecision {
  return legacy.decideSaving(b, offers, opts) as SavingDecision;
}

/** 추적 상태 — 카드 배지·상세·요약이 공유하는 단일 판정 (basisLimited 포함) */
export function getTrackingState(b: Booking, rec: PriceRecord | null, opts?: EngineOpts): TrackState | null {
  return legacy.hotelTrackState(b, rec, opts) as TrackState | null;
}

/** 관측 기록 기반 가격 상태 (GOOD_PRICE 판정 등) */
export function bookingPriceStatus(b: Booking, obs: PriceObservation[], opts?: EngineOpts) {
  return legacy.bookingPriceStatus(b, obs, opts);
}

/** 여행 단위 요약(₩ 환산) — booked·confirmed·potential·actual 분리 합산 (§31) */
export function tripSavingSummary(
  bookings: Booking[],
  recById: Record<string, PriceRecord>,
  opts?: { today?: string; krwRateOf?: (cur?: string) => number; cfg?: PriceCfg }
): TripSavingSummary {
  return legacy.tripHotelSummary(bookings, recById, opts);
}

/** 호텔 동일성 점수 (0~1) — 메타서치 결과가 '내 호텔'인지 */
export function identityScore(
  idn: { name?: string; placeId?: string; lat?: number; lng?: number },
  prop: { name?: string; placeId?: string; lat?: number; lng?: number }
): number {
  return legacy.identityScore(idn, prop);
}
