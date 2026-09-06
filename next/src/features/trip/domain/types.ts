// Trip/Day/Spot 도메인 모델 — 레거시가 저장·공유·동기화하는 trip JSON(schemaVersion 스탬프)을
// 그대로 타이핑한다. §19: migration 목적은 런타임 구조 전환이며 데이터 스키마 재설계가 아니다.
// 필드 의미의 단일 출처는 lib.js normalizeTrip/normalizeDay/normalizeSpot.

import type { Booking } from '@/features/booking/domain/types';

/** 이동수단 — 일자 기본(day.mode) + 구간별 재정의(spot.legMode) */
export type TransportMode = 'car' | 'taxi' | 'transit' | 'train' | 'walk' | 'bike' | 'flight';

export type CurrencyCode = 'KRW' | 'USD' | 'EUR' | 'JPY' | 'CNY';

/** 장소 카테고리 (lib.js SPOT_CATS) */
export type SpotCategory =
  | 'stay' | 'food' | 'cafe' | 'sight' | 'activity' | 'shop' | 'transport' | 'nature';

export interface OpeningHour {
  /** 요일 (0=일) */ d: number;
  /** 개점(분) */ o: number;
  /** 폐점(분) */ c: number;
}

export interface Spot {
  name: string;
  city: string;
  desc: string;
  /** 좌표 없는 장소는 null (동선·ETA·지도에서 제외) */
  lat: number | null;
  lng: number | null;
  /** 숙소 — 그 날의 종료 기준점(dayAnchor)·다음 날 이월(dayStartAnchor)의 근거 */
  stay?: boolean;
  /** 선택 코스 (필수 아님 표시) */
  opt?: boolean;
  /** 도착 고정 시각 HH:MM — 내가 정한 계획 */
  at?: string;
  /** 예약·입장 시각 HH:MM — 상대가 정한 약속 (일찍 오면 대기, 늦으면 ⚠️) */
  bookAt?: string;
  /** 숙소 연박 수 (1–60) */
  nights?: number;
  /** 체류 시간(분) */
  stayMin?: number;
  /** 그날 쓰는 비용 (하루치 — 예약 총액과 구분) */
  cost?: number;
  cur?: CurrencyCode;
  /** 구간별 이동수단 재정의 — 없으면 일자 기본 */
  legMode?: TransportMode;
  bookUrl?: string;
  /** 숙박 예약 연결 (booking.id) */
  bookingId?: string;
  /** 렌터카 픽업 지점을 이 장소 행에 표시 (booking.id) */
  carPickupId?: string;
  /** 렌터카 반납 지점을 이 장소 행에 표시 (booking.id) */
  carReturnId?: string;
  /** 구글 Place ID — 호텔 identity 매칭에 사용 */
  placeId?: string;
  cat?: SpotCategory;
  hours?: OpeningHour[];
  /** 실행 상태 — 기본 PLANNED는 저장하지 않는다. 자동 완료 판정은 하지 않는다(사용자가 누른다) */
  status?: 'COMPLETED' | 'SKIPPED' | 'CANCELLED';
  // ── 함께 움직이지 않는 시간(§25~§27) ──
  /** 참여자 user_id. **비어 있으면 모든 여행자다** — 기본값이라 저장하지 않는다 */
  who?: string[];
  /** 분리 묶음 키. 같은 키가 **이어지는** 구간이 한 묶음이고, 그 안에서 참여자가 같은 장소들이 한 가지 */
  split?: string;
  /** 갈라졌던 사람들이 다시 만나는 지점. 표시일 뿐이고 시각은 타임라인이 정한다 */
  reunion?: boolean;
}

export interface DayFlight {
  code: string;
  dep: string;
  arr: string;
  depAt?: string;
  arrAt?: string;
}

export interface Day {
  title: string;
  drive: string;
  note: string;
  mode: TransportMode;
  spots: Spot[];
  /** 출발 시각 HH:MM (기본 09:00) */
  startAt?: string;
  /** 'none'이면 전날 이월 없음 (공항 이동일·야간열차) */
  startPolicy?: 'none';
  timeZone?: string;
  flight?: DayFlight;
}

export interface Trip {
  id: string;
  name: string;
  /** YYYY-MM-DD ('' 가능) */
  start: string;
  days: Day[];
  timeZone?: string;
  colorBy?: 'city' | 'day';
  /** 예약(가격 추적) — 비면 필드 자체가 생략된다 */
  bookings?: Booking[];
  schemaVersion?: number;
}
