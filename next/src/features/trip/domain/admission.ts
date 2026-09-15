/** 명소의 조건과 사용자의 예약 여부는 다른 정보다. bookAt/bookingId로 추론하지 않는다. */
export type AdmissionRequirement = 'REQUIRED' | 'RECOMMENDED' | 'NOT_REQUIRED' | 'UNKNOWN';

export interface SpotAdmission {
  source: 'USER';
  requirement: AdmissionRequirement;
  personalStatus?: 'NOT_BOOKED' | 'BOOKED';
  officialURL?: string;
  /** 사용자가 확인한 때만 입력한다. 저장/조회 시각으로 자동 생성하지 않는다. */
  checkedAt?: string;
  note?: string;
  people?: number;
}

/** 외부 참고 가격. spot.cost와 분리하며 사용자가 확인하기 전 비용에 반영하지 않는다. */
export interface AdmissionQuote {
  amount: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  currency: string;
  unit: 'PER_PERSON' | 'TOTAL' | 'UNKNOWN';
  age: string | null;
  ticket: string | null;
  validFrom: string | null;
  validTo: string | null;
  conditions: string[];
  sourceURL: string;
  checkedAt: string;
}

export interface PlaceAdmissionDetails {
  provider: 'kakao' | 'google';
  providerId: string;
  status: 'AVAILABLE' | 'NO_DATA' | 'NOT_CONNECTED' | 'ERROR';
  requirement: AdmissionRequirement;
  quote: AdmissionQuote | null;
  sourceURL: string | null;
  checkedAt: string | null;
  stale: boolean;
}
