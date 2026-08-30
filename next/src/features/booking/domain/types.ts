// Booking 도메인 모델 — discriminated union (§7). 필드명은 레거시가 저장·공유·동기화하는
// trip.bookings의 실제 스키마(lib.js normalizeBooking)를 따른다: 저장 구조 재설계는 별도 작업(§19)이고,
// 여기서 이름을 바꾸면 양방향 매핑 계층이 생겨 Strangler 병행 운영이 깨진다.
//   (개념 대응: price=bookedPrice · track=trackingEnabled · start/end=기간)

import type { CurrencyCode } from '@/features/trip/domain/types';

export type BookingType = 'hotel' | 'car' | 'flight';

/** 렌터카 변속기 — string 남발 금지 (§30) */
export type Transmission = 'automatic' | 'manual';
/** 주행거리 정책 */
export type MileagePolicy = 'UNLIMITED' | 'LIMITED';
/** 보험 수준 (FULL > CDW > BASIC) */
export type InsuranceLevel = 'BASIC' | 'CDW' | 'FULL';

export interface BookingBase {
  /** 클라이언트 생성 id (_ID_RE 검증) */
  id: string;
  type: BookingType;
  title: string;
  /** 예약처 이름 */
  provider?: string;
  /** 예약 확인 URL */
  url?: string;
  /** 예약가 — 기간 전체 총액 (하루치 아님). 통화는 cur */
  price: number;
  /** 미지정이면 KRW 취급 */
  cur?: CurrencyCode;
  /** 시작일 YYYY-MM-DD (숙박=체크인, 렌터카/항공=이용 시작) */
  start?: string;
  /** 종료일 YYYY-MM-DD (숙박=체크아웃 — 비용 배분은 [start, end) / 렌터카·항공은 양끝 포함) */
  end?: string;
  /** 무료 취소 기한 (이 날짜까지 취소 수수료 0) */
  freeCancelUntil?: string;
  /** 지금 취소하면 내는 수수료 — 실질 절약액 계산에 반영 */
  cancelFee?: number;
  /** 환불 가능 여부 — 조건 매칭 기준. undefined=모름 */
  refundable?: boolean;
  /** 가격 추적 on/off (기본 on) */
  track: boolean;
  /** 재예약으로 실제 절약한 누적액 (확정/잠재와 절대 섞지 않는다 — §31) */
  saved?: number;
  updatedAt?: string;
}

export interface HotelBooking extends BookingBase {
  type: 'hotel';
  /** 투숙 인원 (1–8) */
  adults?: number;
  /** 객실 수 (1–4) — 시세 basis(1실)와 다르면 확정 절약 금지 (P0-1) */
  rooms?: number;
  roomName?: string;
  breakfast?: boolean;
  /** provider property 매핑 캐시 — 재검색 생략용 */
  ptoken?: string;
  /** 시세 조회용 영문명 캐시 */
  enName?: string;
}

export interface CarBooking extends BookingBase {
  type: 'car';
  carPickup?: string;
  /** IATA 3자리 */
  carPickupCode?: string;
  /** 반납 지점은 (장소, 코드) 한 쌍 — 하나라도 입력되면 픽업에서 물려받지 않는다 (carReturnPoint) */
  carReturn?: string;
  carReturnCode?: string;
  carPickupTime?: string;
  carReturnTime?: string;
  carClass?: string;
  transmission?: Transmission;
  mileage?: MileagePolicy;
  insurance?: InsuranceLevel;
  deposit?: number;
  driverAge?: number;
}

export interface FlightBooking extends BookingBase {
  type: 'flight';
}

export type Booking = HotelBooking | CarBooking | FlightBooking;
